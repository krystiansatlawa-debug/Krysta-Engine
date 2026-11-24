import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import type { Download } from "@types";
import { logger } from "./logger";

const run = promisify(execFile);
const active = new Map<string, Promise<boolean>>();
let nextReputationRequest = 0;

// Hash-only, opt-in reputation lookup. Never upload downloaded files.
export async function lookupFileReputation(sha256: string) {
  const key = process.env.KRYSTA_VIRUSTOTAL_API_KEY;
  if (process.env.KRYSTA_VIRUSTOTAL_ENABLED !== "1" || !key || !/^[a-f0-9]{64}$/.test(sha256)) return { status: "unavailable" as const };
  if (Date.now() < nextReputationRequest) return { status: "deferred" as const };
  nextReputationRequest = Date.now() + 16000;
  try {
    const response = await fetch("https://www.virustotal.com/api/v3/files/" + sha256, {
      headers: { "x-apikey": key }, redirect: "error", signal: AbortSignal.timeout(15000)
    });
    if (response.status === 404) return { status: "unknown" as const };
    if (response.status === 429) nextReputationRequest = Date.now() + 60000;
    if (!response.ok) return { status: "unavailable" as const };
    const body = await response.json() as { data?: { id?: string; attributes?: { last_analysis_stats?: Record<string, number>; last_analysis_date?: number; reputation?: number } } };
    const attrs = body.data?.attributes;
    const stats = attrs?.last_analysis_stats;
    if (body.data?.id !== sha256 || !stats || !attrs || !["malicious", "suspicious", "undetected", "harmless"].every(k => Number.isSafeInteger(stats[k]) && stats[k] >= 0)) return { status: "unknown" as const };
    return { status: "reported" as const, stats, analysisDate: attrs.last_analysis_date, reputation: attrs.reputation };
  } catch { return { status: "unavailable" as const }; }
}

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

// Retry an ambiguous report once, respecting the shared API cooldown.
export async function recheckAmbiguousReputation(sha256: string, initial: Awaited<ReturnType<typeof lookupFileReputation>>) {
  if (assessReputation(initial).level !== "ambiguous") return { initial, repeated: null };
  const delay = Math.max(0, nextReputationRequest - Date.now());
  if (delay > 20000) return { initial, repeated: null };
  await new Promise<void>(resolve => setTimeout(resolve, delay + 100));
  const repeated = await lookupFileReputation(sha256);
  // A later report cannot erase an earlier detection automatically.
  return { initial, repeated };
}

// A disagreement is not proof of a false positive.
export function assessReputation(report: Awaited<ReturnType<typeof lookupFileReputation>>) {
  if (report.status !== "reported" || !report.stats) return { level: "unknown", reason: "Brak wiarygodnego raportu reputacji.", requiresReview: true };
  const { malicious, suspicious, harmless, undetected } = report.stats;
  if (malicious >= 2) return { level: "high", reason: "Co najmniej dwa silniki zgłaszają zagrożenie; wymagana weryfikacja.", requiresReview: true };
  if (malicious > 0 || suspicious > 0) return { level: "ambiguous", reason: "Niejednoznaczne wykrycie. Możliwy fałszywy alarm, ale nie potwierdzono bezpieczeństwa.", requiresReview: true };
  const date = report.analysisDate;
  if (typeof date !== "number" || !Number.isFinite(date) || date * 1000 > Date.now() || Date.now() - date * 1000 > 7 * 86400000 || harmless + undetected < 10) return { level: "unknown", reason: "Raport nieaktualny lub niewystarczający.", requiresReview: true };
  return { level: "no-detections", reason: "Brak wykryć w dostępnym raporcie; nie stanowi gwarancji bezpieczeństwa.", requiresReview: false };
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
  let misleadingExtensions = 0;
  let bidiNames = 0;
  let executableScripts = 0;
  const signatureCandidates: string[] = [];
  const reputationCandidates = new Set<string>();
  const fingerprints: string[] = [];
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
      const digest = hash.digest("hex");
      fingerprints.push(JSON.stringify([path.relative(target, current), digest]));
      const ext = path.extname(current).toLowerCase();
      const name = path.basename(current);
      if (/[\u202a-\u202e\u2066-\u2069]/u.test(name)) bidiNames++;
      if (executableExtensions.has(ext) && /\.(pdf|jpg|jpeg|png|txt|docx|mp4)\.[^.]+$/i.test(name)) misleadingExtensions++;
      if ([".bat", ".cmd", ".ps1", ".vbs", ".js", ".hta", ".wsf"].includes(ext)) executableScripts++;
      if (/\.(zip|rar|7z|tar|gz|bz2|xz|iso|cab|part\d+\.rar|\d{3})$/i.test(current)) archives++;
      const handle = await fs.open(current, "r");
      try {
        const header = Buffer.alloc(2);
        const { bytesRead } = await handle.read(header, 0, header.length, 0);
        const mz = bytesRead === 2 && header[0] === 0x4d && header[1] === 0x5a;
        if (mz || [".msi", ".msp", ".ps1", ".psm1", ".cat"].includes(ext)) {
          if (signatureCandidates.length < 500) signatureCandidates.push(current);
        }
        if ((mz || executableExtensions.has(ext)) && reputationCandidates.size < 500) reputationCandidates.add(digest);
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
  return { files, bytes, executableTypes, disguisedExecutables, archives, suspiciousProperties: { misleadingExtensions, bidiNames, executableScripts }, signatureCandidates, reputationCandidates: [...reputationCandidates], fingerprint: createHash("sha256").update(JSON.stringify(fingerprints.sort())).digest("hex") };
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
      if (inventory.suspiciousProperties.misleadingExtensions || inventory.suspiciousProperties.bidiNames || inventory.disguisedExecutables) logger.warn("[Security Shield] Wykryto podejrzane właściwości nazw lub formatów plików; wymagana dodatkowa weryfikacja.");
      const reputationLevels: string[] = [];
      if (process.env.KRYSTA_VIRUSTOTAL_ENABLED === "1") {
        for (const digest of inventory.reputationCandidates) {
          const reputation = await lookupFileReputation(digest);
          const assessment = assessReputation(reputation);
          reputationLevels.push(assessment.level);
          if (assessment.level === "ambiguous") {
            const recheck = await recheckAmbiguousReputation(digest, reputation);
            if (recheck.repeated) reputationLevels.push(assessReputation(recheck.repeated).level);
            logger.info("[Security Shield] Ponowna weryfikacja; pierwotne wykrycie pozostaje w ocenie:", digest, recheck);
          }
          logger.info("[Security Shield] Hash reputation observation:", digest, reputation, assessment);
          if (reputation.status === "deferred" || reputation.status === "unavailable") break;
        }
      }
      const systemRoot = process.env.SystemRoot;
      if (!systemRoot || !path.isAbsolute(systemRoot)) return false;
      const powershell = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      const signatureSummary: Record<string, number> = {};
      const publishers = new Set<string>();
      for (const candidate of inventory.signatureCandidates) {
        try {
          const result = await run(powershell, ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference=\'Stop\'; $s=Get-AuthenticodeSignature -LiteralPath $env:KRYSTA_SIGNATURE_PATH; [pscustomobject]@{status=$s.Status.ToString();publisher=$s.SignerCertificate.Subject} | ConvertTo-Json -Compress"], { windowsHide: true, timeout: 15000, maxBuffer: 16384, env: {...process.env, KRYSTA_SIGNATURE_PATH: candidate} });
          const observation = JSON.parse(result.stdout.trim()) as {status?: string; publisher?: string};
          const status = observation.status ?? "Unknown";
          if (status === "Valid" && typeof observation.publisher === "string") publishers.add(observation.publisher.slice(0, 300));
          const key = ["Valid", "NotSigned", "HashMismatch", "NotTrusted", "UnknownError", "NotSupportedFileFormat", "Incompatible"].includes(status) ? status : "Unknown";
          signatureSummary[key] = (signatureSummary[key] ?? 0) + 1;
        } catch { signatureSummary.Unknown = (signatureSummary.Unknown ?? 0) + 1; }
      }
      logger.info("[Security Shield] Authenticode observations (not a malware verdict):", signatureSummary, [...publishers]);
      const { stdout } = await run(powershell, ["-NoProfile", "-NonInteractive", "-Command",
        "$ErrorActionPreference='Stop'; $s=Get-MpComputerStatus; if (-not $s.AntivirusEnabled -or -not $s.AMServiceEnabled) { throw 'Defender unavailable' }; $before=Get-Date; Start-MpScan -ScanType CustomScan -ScanPath $env:KRYSTA_SCAN_PATH -ErrorAction Stop; $after=Get-MpComputerStatus; $detections=@(Get-MpThreatDetection -ErrorAction Stop | Where-Object { $_.InitialDetectionTime -ge $before }); [pscustomobject]@{ enabled=[bool]$after.AntivirusEnabled; realtime=[bool]$after.RealTimeProtectionEnabled; signaturesOutOfDate=[bool]$after.DefenderSignaturesOutOfDate; recentDetections=$detections.Count } | ConvertTo-Json -Compress"],
        { windowsHide: true, timeout: 2 * 60 * 60 * 1000, maxBuffer: 1024 * 1024, env: {...process.env, KRYSTA_SCAN_PATH: target} });
      const report = JSON.parse(stdout.trim()) as { enabled?: boolean; realtime?: boolean; signaturesOutOfDate?: boolean; recentDetections?: number };
      const reasons: string[] = [];
      const high = (typeof report.recentDetections === "number" && report.recentDetections > 0) || reputationLevels.includes("high");
      if (high) reasons.push("Silnik antywirusowy zgłosił zagrożenie; wymagana weryfikacja.");
      if (reputationLevels.includes("ambiguous")) reasons.push("Niejednoznaczny raport reputacji.");
      if (signatureSummary.HashMismatch || signatureSummary.NotTrusted) reasons.push("Nieprawidłowy lub niezaufany podpis.");
      if (inventory.disguisedExecutables || inventory.suspiciousProperties.misleadingExtensions || inventory.suspiciousProperties.bidiNames) reasons.push("Podejrzane właściwości plików.");
      const level = high ? "high" : reasons.length ? "review" : "unverified";
      if (!reasons.length) reasons.push("Brak potwierdzonego wyniku skanowania konkretnych plików.");
      logger.info("[Security Shield] Ocena zagrożenia:", { level, reasons, verified: false });
      if (report.enabled !== true || report.realtime !== true || report.signaturesOutOfDate !== false || report.recentDetections !== 0) {
        logger.warn("[Security Shield] Defender reported detections or protection is not fully available");
        return false;
      }
      const finalInventory = await inspectDownloadTree(base, target);
      if (finalInventory.fingerprint !== inventory.fingerprint) {
        logger.warn("[Security Shield] Download contents changed during antivirus scan; verdict invalidated");
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
