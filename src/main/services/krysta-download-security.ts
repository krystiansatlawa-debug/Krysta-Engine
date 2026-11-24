import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import type { Download } from "@types";
import { logger } from "./logger";

const run = promisify(execFile);
const active = new Map<string, Promise<boolean>>();
export async function detectRegisteredAntivirus(): Promise<{ name: string; productState: number | null }[] | null> {
  if (process.platform !== "win32") return null;
  const root = process.env.SystemRoot;
  if (!root || !path.isAbsolute(root)) return null;
  try {
    const { stdout } = await run(path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), [
      "-NoProfile", "-NonInteractive", "-Command",
      "$ErrorActionPreference='Stop'; $items=@(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct | Select-Object displayName,productState); ConvertTo-Json -InputObject $items -Compress"
    ], { windowsHide: true, timeout: 15000, maxBuffer: 256 * 1024 });
    const rows: unknown = JSON.parse(stdout.trim());
    if (!Array.isArray(rows)) return null;
    return rows.filter((row) => row && typeof row.displayName === "string").map((row) => ({
      name: String(row.displayName).slice(0, 200),
      productState: Number.isInteger(row.productState) ? row.productState : null
    }));
  } catch {
    return null;
  }
}

export async function scanCompletedDownload(download: Download): Promise<boolean> {
  if (process.platform !== "win32") return false;
  if (!download.folderName || !download.downloadPath) return false;
  const base = path.resolve(download.downloadPath);
  const target = path.resolve(base, download.folderName);
  const relative = path.relative(base, target);
  if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) return false;
  const existing = active.get(target);
  if (existing) return existing;
  const task = (async () => {
    try {
      const products = await detectRegisteredAntivirus();
      logger.info("[Security Shield] Registered antivirus products:", products === null ? "unknown" : products.map((product) => product.name));
      // Registration alone does not establish active protection or a clean scan.
      const stat = await fs.lstat(target);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) return false;
      const systemRoot = process.env.SystemRoot;
      if (!systemRoot || !path.isAbsolute(systemRoot)) return false;
      const powershell = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      const { stdout } = await run(powershell, ["-NoProfile", "-NonInteractive", "-Command",
        "$ErrorActionPreference='Stop'; $s=Get-MpComputerStatus; if (-not $s.AntivirusEnabled -or -not $s.AMServiceEnabled) { throw 'Defender unavailable' }; $before=Get-Date; Start-MpScan -ScanType CustomScan -ScanPath $env:KRYSTA_SCAN_PATH -ErrorAction Stop; $after=Get-MpComputerStatus; $detections=@(Get-MpThreatDetection -ErrorAction Stop | Where-Object { $_.InitialDetectionTime -ge $before }); [pscustomobject]@{ enabled=[bool]$after.AntivirusEnabled; realtime=[bool]$after.RealTimeProtectionEnabled; signaturesOutOfDate=[bool]$after.DefenderSignaturesOutOfDate; recentDetections=$detections.Count } | ConvertTo-Json -Compress"],
        { windowsHide: true, timeout: 2 * 60 * 60 * 1000, maxBuffer: 1024 * 1024, env: {...process.env, KRYSTA_SCAN_PATH: target} });
      const report = JSON.parse(stdout.trim()) as { enabled?: boolean; realtime?: boolean; signaturesOutOfDate?: boolean; recentDetections?: number };
      if (report.enabled !== true || report.realtime !== true || report.signaturesOutOfDate !== false || report.recentDetections !== 0) {
        logger.warn("[Security Shield] Defender reported detections or protection is not fully available");
        return false;
      }
      logger.info("[Security Shield] Defender reported no new detections; scan-specific verdict remains unverified");
      // Global detection history cannot establish a scan-specific clean verdict.
      return false;
    } catch (error) {
      logger.warn("[Security Shield] Download scan unavailable or failed", error);
      return false;
    }
  })();
  active.set(target, task);
  try { return await task; } finally { active.delete(target); }
}
