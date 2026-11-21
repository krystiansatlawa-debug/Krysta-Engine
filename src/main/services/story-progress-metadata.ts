import { lstat, open, readdir } from "node:fs/promises";
import path from "node:path";
import type { AutomaticGameStoryProgress } from "@types";

type MetadataProgress = Omit<AutomaticGameStoryProgress, "savedAt">;
type Candidate = { file: string; savedAt: number };

const MAX_METADATA_BYTES = 96 * 1024;
const MAX_METADATA_FILES = 96;
const MAX_FOLDER_ENTRIES = 500;
const METADATA_EXTENSION = /\.(?:json|ini|xml)$/i;
const SAVE_FILE_EXTENSION = /\.(?:sav|save|json|ini|xml|dat|bin|srm|sra|state|dsv|gci|mcr|ps2)$/i;
const ROCKSTAR_SLOT = /^(?:SGTA5|SRDR3)\d{4}$/i;

const normalizeKey = (key: string) =>
  key.toLowerCase().replace(/[^a-z0-9]/g, "");

const progressKeys = new Set([
  "storyprogress",
  "storyprogresspercent",
  "storycompletionpercent",
  "storycompletionpercentage",
  "mainstoryprogress",
  "mainstoryprogresspercent",
  "mainstorycompletionpercent",
  "campaignprogress",
  "campaignprogresspercent",
  "campaigncompletionpercent",
  "campaigncompletionpercentage",
  "mainquestprogresspercent",
]);
const scopedPercentKeys = new Set([
  "percent",
  "percentage",
  "progresspercent",
  "completionpercent",
  "completionpercentage",
]);
const trackedMissionKeys = new Set([
  "currentmission",
  "currentmissionname",
  "activemission",
  "activemissionname",
  "currentquest",
  "currentquestname",
  "activequest",
  "activequestname",
  "trackedquest",
  "trackedquestname",
  "mainquestname",
  "mainmissionname",
]);
const missionDescriptionKeys = new Set([
  "missiondescription",
  "missionsummary",
  "questdescription",
  "questsummary",
  "mainquestdescription",
  "mainmissiondescription",
]);

function percentage(value: unknown): number | null {
  if (typeof value === "boolean") return null;
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\s*\d{1,3}(?:[.,]\d{1,2})?\s*%?\s*$/.test(value)
        ? Number(value.trim().replace("%", "").replace(",", "."))
        : NaN;
  return Number.isFinite(number) && number >= 0 && number <= 100
    ? number
    : null;
}

function safeText(value: unknown, maxLength: number): string {
  if (
    typeof value !== "string" ||
    value.length > maxLength ||
    /[\u0000-\u001f\u007f\ufffd]/u.test(value)
  )
    return "";
  return value.trim();
}

/**
 * Extract only explicitly labelled story/campaign data. Save timestamps,
 * playtime and achievement counts must never masquerade as story completion.
 */
export function parseGenericStoryMetadata(
  input: string,
  format: "json" | "ini" | "xml" = "json"
): MetadataProgress | null {
  if (!input || input.length > MAX_METADATA_BYTES) return null;
  let data: unknown;
  try {
    if (format === "json") data = JSON.parse(input.replace(/^\uFEFF/, ""));
    else {
      const record: Record<string, unknown> = {};
      if (format === "ini") {
        let section: Record<string, unknown> = record;
        for (const line of input.split(/\r?\n/)) {
          const heading = /^\s*\[([^\]]{1,64})\]\s*$/.exec(line);
          if (heading) {
            section = {};
            record[heading[1]] = section;
            continue;
          }
          const match = /^\s*([A-Za-z][A-Za-z0-9_ -]{0,63})\s*=\s*(.{0,500})\s*$/.exec(line);
          if (match) section[match[1]] = match[2].trim();
        }
      } else {
        const elements = /<([a-z][\w-]{0,63})>([^<>]{1,500})<\/\1>/gi;
        for (const match of input.matchAll(elements)) {
          record[match[1]] = match[2].trim();
        }
      }
      data = record;
    }
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;

  let percent: number | null = null;
  let saveTitle = "";
  let description = "";
  let visited = 0;

  const walk = (node: unknown, ancestors: string[], depth: number) => {
    if (
      depth > 5 ||
      visited++ > 300 ||
      !node ||
      typeof node !== "object" ||
      Array.isArray(node)
    )
      return;

    for (const [rawKey, value] of Object.entries(node)) {
      const key = normalizeKey(rawKey);
      const relatedToStory = ancestors.some((part) =>
        /^(?:story|mainstory|campaign|mainquest|mainmission|storyprogress|storydata|questprogress)$/.test(part)
      );
      const unrelated = ancestors.some((part) =>
        /^(?:achievements?|skills?|inventory|statistics|settings|config|graphics)$/.test(part)
      );
      if (unrelated) continue;

      if (
        percent === null &&
        (progressKeys.has(key) ||
          (relatedToStory && scopedPercentKeys.has(key)))
      ) {
        percent = percentage(value);
      }
      if (!saveTitle && trackedMissionKeys.has(key)) {
        saveTitle = safeText(value, 160);
      }
      if (!description && missionDescriptionKeys.has(key)) {
        description = safeText(value, 500);
      }
      if (typeof value === "object" && value !== null) {
        walk(value, [...ancestors, key], depth + 1);
      }
    }
  };

  walk(data, [], 0);
  if (percent === null && !saveTitle) return null;
  return {
    percent,
    saveTitle,
    ...(description && { missionDescription: description }),
  };
}

async function readMetadataFile(file: string, savedAt: number) {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (ext !== "json" && ext !== "ini" && ext !== "xml") return null;

  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(MAX_METADATA_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_METADATA_BYTES || bytesRead === 0) return null;
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    if (text.includes("\ufffd")) return null;
    const progress = parseGenericStoryMetadata(text, ext);
    return progress ? { ...progress, savedAt } : null;
  } finally {
    await handle.close();
  }
}

export async function readGenericStoryMetadataFiles(
  files: readonly string[],
  canContinue: () => boolean
): Promise<AutomaticGameStoryProgress | null> {
  const candidates: Candidate[] = [];
  for (const file of new Set(files)) {
    if (!canContinue()) return null;
    if (!path.isAbsolute(file) || !METADATA_EXTENSION.test(file)) continue;
    const info = await lstat(file).catch(() => null);
    if (
      !info?.isFile() ||
      info.isSymbolicLink() ||
      info.size === 0 ||
      info.size > MAX_METADATA_BYTES
    )
      continue;
    candidates.push({ file, savedAt: info.mtimeMs });
  }
  candidates.sort((a, b) => b.savedAt - a.savedAt);
  for (const { file, savedAt } of candidates.slice(0, MAX_METADATA_FILES)) {
    if (!canContinue()) return null;
    const progress = await readMetadataFile(file, savedAt).catch(() => null);
    if (progress) return progress;
  }
  return null;
}

/** Scan only a user-chosen folder and its immediate subdirectories. */
export async function discoverSelectedStorySaveFiles(
  folder: string,
  canContinue: () => boolean
): Promise<string[]> {
  if (!path.isAbsolute(folder)) return [];
  const root = await lstat(folder).catch(() => null);
  if (!root?.isDirectory() || root.isSymbolicLink()) return [];

  const files: string[] = [];
  const directories: Array<{ folder: string; depth: number }> = [
    { folder, depth: 0 },
  ];
  let inspected = 0;
  while (directories.length && inspected < MAX_FOLDER_ENTRIES) {
    if (!canContinue()) break;
    const next = directories.shift()!;
    const entries = await readdir(next.folder, { withFileTypes: true }).catch(
      () => []
    );
    for (const entry of entries) {
      if (!canContinue() || inspected++ >= MAX_FOLDER_ENTRIES) break;
      if (entry.isSymbolicLink()) continue;
      const file = path.join(next.folder, entry.name);
      if (entry.isDirectory() && next.depth < 2) {
        directories.push({ folder: file, depth: next.depth + 1 });
      } else if (
        entry.isFile() &&
        (SAVE_FILE_EXTENSION.test(entry.name) ||
          ROCKSTAR_SLOT.test(entry.name))
      ) {
        files.push(file);
      }
    }
  }
  return files;
}
