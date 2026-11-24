import { createHash } from "node:crypto";
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

// Enumerate the entire tree without following symbolic links or junctions.
async function inspectDownloadTree(base: string, target: string) {
  const realBase = await fs.realpath(base);
  const realTarget = await fs.realpath(target);
  const relative = path.relative(realBase, realTarget);
  if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) throw new Error("Download outside scan root");
  const pending = [target];
  let files = 0;
  let entries = 0;
  let bytes = 0;
  const executableExtensions = new Set([".exe", ".dll", ".msi", ".msp", ".sys", ".scr", ".com", ".cpl", ".ocx", ".bat", ".cmd", ".ps1", ".psm1", ".vbs", ".vbe", ".js", ".jse", ".wsf", ".wsh", ".hta", ".lnk", ".reg", ".py", ".sh"]);
  const executableTypes: Record<string, number> = {};
  let disguisedExecutables = 0;
  let archives = 0;
  const fingerprint = createHash("sha256");
  while (pending.length) {
    const current = pending.pop()!;
    if (++entries > 500000) throw new Error("Download tree exceeds inspection limit");
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) throw new Error("Download contains a symbolic link or junction");
    const real = await fs.realpath(current);
    const rel = path.relative(realTarget, real);
    if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) throw new Error("Download entry outside scan root");
    if (stat.isDirectory()) {
      const directory = await fs.opendir(current);
      for await (const entry of directory) {
        if (entries + pending.length >= 500000) throw new Error("Download tree exceeds inspection limit");
        pending.push(path.join(current, entry.name));
      }
    } else if (stat.isFile()) {
      files++;
      bytes += stat.size;
      const hash = createHash("sha256");
      const file = await fs.open(current, "r");
      try {
        for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk);
        const after = await file.stat();
        if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error("File changed during inspection");
      } finally { await file.close(); }
      fingerprint.update(JSON.stringify([path.relative(target, current), hash.digest("hex")]));
      const ext = path.extname(current).toLowerCase();
      if (/\.(zip|rar|7z|tar|gz|bz2|xz|iso|cab|part\d+\.rar|\d{3})$/i.test(current)) archives++;
      const handle = await fs.open(current, "r");
      try {
        const header = Buffer.alloc(2);
        const { bytesRead } = await handle.read(header, 0, header.length, 0);
        const mz = bytesRead === 2 && header[0] === 0x4d && header[1] === 0x5a;
        if (executableExtensions.has(ext)) {
          executableTypes[ext] = (executableTypes[ext] ?? 0) + 1;
        } else if (mz) {
          disguisedExecutables++;
        }
      } finally {
        await handle.close();
      }
    } else {
      throw new Error("Unsupported download entry");
    }
  }
  if (!files) throw new Error("No files to scan");
  return { files, bytes, executableTypes, disguisedExecutables, archives, fingerprint: fingerprint.digest("hex") };
}

export async function scanCompletedDownload(download: Download, afterExtraction = false): Promise<boolean> {
  if (process.platform !== "win32") return false;
  if (!download.folderName || !download.downloadPath) return false;
  const base = path.resolve(download.downloadPath);
  const target = path.resolve(base, download.folderName);
  const relative = path.relative(base, target);
  if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) return false;
  const existing = active.get(target);
  if (existing) {
    if (!afterExtraction) return existing;
    await existing;
    return scanCompletedDownload(download);
  }
  const task = (async () => {
    try {
      const products = await detectRegisteredAntivirus();
      logger.info("[Security Shield] Registered antivirus products:", products === null ? "unknown" : products.map((product) => product.name));
      // Registration alone does not establish active protection or a clean scan.
      const inventory = await inspectDownloadTree(base, target);
      logger.info("[Security Shield] Download tree inventory:", inventory);
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
