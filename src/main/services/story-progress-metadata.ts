import { lstat, open, readdir } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { SaxesParser } from "saxes";
import type { AutomaticGameStoryProgress } from "@types";

type MetadataProgress = Omit<AutomaticGameStoryProgress, "savedAt">;
type Candidate = { file: string; savedAt: number };

const MAX_METADATA_BYTES = 512 * 1024;
const MAX_METADATA_FILES = 96;
const MAX_FOLDER_ENTRIES = 500;
const METADATA_EXTENSION = /\.(?:json|ini|xml|sav|save|dat|bin|gz)$/i;
const SAVE_FILE_EXTENSION =
  /\.(?:sav(?:\.\d+)?|save|json|ini|xml|dat|bin|srm|sra|state|dsv|gci|mcr|ps2|gz)$/i;
const ROCKSTAR_SLOT = /^(?:(?:SGTA5|SRDR3)\d{4}|SGTA4\d{2})$/i;

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
const scopedMissionTitleKeys = new Set(["name", "title", "displayname"]);
const scopedMissionCountKeys = new Set([
  "completedmissions",
  "missionscompleted",
  "completedquests",
  "questscompleted",
]);
const explicitMissionCountKeys = new Set([
  "completedstorymissions",
  "completedcampaignmissions",
  "completedmainquests",
  "completedmainmissions",
]);
const scopedMissionTotalKeys = new Set(["totalmissions", "totalquests"]);
const explicitMissionTotalKeys = new Set([
  "totalstorymissions",
  "totalcampaignmissions",
  "totalmainquests",
  "totalmainmissions",
]);
const explicitChapterKeys = new Set([
  "currentstorychapter",
  "currentcampaignchapter",
  "storychaptername",
  "campaignchaptername",
]);
const scopedTitleKeys = new Set([
  "currentchapter",
  "currentchaptername",
  "chaptername",
  "chaptertitle",
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
      : typeof value === "string" &&
          /^\s*\d{1,3}(?:[.,]\d{1,2})?\s*%?\s*$/.test(value)
        ? Number(value.trim().replace("%", "").replace(",", "."))
        : NaN;
  return Number.isFinite(number) && number >= 0 && number <= 100
    ? number
    : null;
}

function missionCount(value: unknown): number | null {
  if (
    Array.isArray(value) &&
    value.length <= 10_000 &&
    value.every((entry) => !!safeText(entry, 160))
  ) {
    return new Set(value.map((entry: string) => entry.trim())).size;
  }
  const count =
    typeof value === "string" && /^\d{1,5}$/.test(value.trim())
      ? Number(value)
      : value;
  return typeof count === "number" &&
    Number.isInteger(count) &&
    count >= 0 &&
    count <= 10_000
    ? count
    : null;
}

function safeText(value: unknown, maxLength: number): string {
  if (
    typeof value !== "string" ||
    value.length > maxLength ||
    [...value].some(
      (ch) => ch.charCodeAt(0) < 32 || ch === "\u007f" || ch === "\ufffd"
    )
  )
    return "";
  return value.trim();
}

function parseXml(input: string): Record<string, unknown> {
  const root: Record<string, unknown> = Object.create(null);
  const stack = [{ fields: root, text: "" }];
  const parser = new SaxesParser();
  parser.on("doctype", () => {
    throw new Error("Unexpected document type in a save file");
  });
  parser.on("opentag", ({ attributes }) => {
    if (stack.length > 20)
      throw new Error("Save metadata is nested too deeply");
    stack.push({
      fields: Object.assign(Object.create(null), attributes),
      text: "",
    });
  });
  const appendText = (text: string) => {
    stack[stack.length - 1].text += text;
  };
  parser.on("text", appendText);
  parser.on("cdata", appendText);
  parser.on("closetag", ({ name }) => {
    const { fields, text } = stack.pop()!;
    const parent = stack[stack.length - 1].fields;
    // Repeated nodes can describe different slots or quests. Do not combine them.
    parent[name] = Object.hasOwn(parent, name)
      ? []
      : Object.keys(fields).length
        ? fields
        : text.trim();
  });
  parser.write(input).close();
  return root;
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
    else if (format === "xml") data = parseXml(input);
    else {
      const record: Record<string, unknown> = Object.create(null);
      let section = record;
      for (const line of input.split(/\r?\n/)) {
        const heading = /^\s*\[([^\]]{1,64})\]\s*$/.exec(line);
        if (heading) {
          section = Object.create(null);
          record[heading[1]] = section;
          continue;
        }
        const match =
          /^\s*([A-Za-z][A-Za-z0-9_ -]{0,63})\s*=\s*(.{0,500})\s*$/.exec(line);
        if (match) section[match[1]] = match[2].trim();
      }
      data = record;
    }
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;

  let percent: number | null = null;
  let saveTitle = "";
  let chapter = "";
  let description = "";
  let missionProgress:
    | { completedMissions: number; totalMissions?: number }
    | undefined;
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

    const relatedToStory = ancestors.some((part) =>
      /^(?:story|mainstory|campaign|mainquest|mainmission|storyprogress|storydata|questprogress)$/.test(
        part
      )
    );
    if (
      ancestors.some((part) =>
        /^(?:achievements?|skills?|inventory|stats|statistics|settings|config|graphics|sidequests?|sidemissions?|multiplayer|lobbies|online)$/.test(
          part
        )
      )
    )
      return;
    const insideTrackedMission = trackedMissionKeys.has(ancestors.at(-1) ?? "");
    let completedMissions: number | null = null;
    let totalMissions: number | null = null;

    for (const [rawKey, value] of Object.entries(node)) {
      const key = normalizeKey(rawKey);
      if (
        explicitMissionCountKeys.has(key) ||
        (relatedToStory && scopedMissionCountKeys.has(key))
      ) {
        completedMissions ??= missionCount(value);
      }
      if (
        explicitMissionTotalKeys.has(key) ||
        (relatedToStory && scopedMissionTotalKeys.has(key))
      ) {
        if (!Array.isArray(value)) totalMissions ??= missionCount(value);
      }
      if (
        percent === null &&
        (progressKeys.has(key) ||
          (relatedToStory && scopedPercentKeys.has(key)))
      ) {
        percent = percentage(value);
      }
      if (
        !saveTitle &&
        (trackedMissionKeys.has(key) ||
          (insideTrackedMission && scopedMissionTitleKeys.has(key)))
      ) {
        saveTitle = safeText(value, 160);
      }
      if (
        !chapter &&
        (explicitChapterKeys.has(key) ||
          (relatedToStory && scopedTitleKeys.has(key)))
      ) {
        chapter = safeText(value, 160);
      }
      if (
        !description &&
        (missionDescriptionKeys.has(key) ||
          (insideTrackedMission &&
            (key === "description" || key === "summary")))
      ) {
        description = safeText(value, 500);
      }
      if (typeof value === "object" && value !== null) {
        walk(value, [...ancestors, key], depth + 1);
      }
    }
    if (!missionProgress && completedMissions !== null) {
      missionProgress = {
        completedMissions,
        ...(totalMissions &&
          totalMissions >= completedMissions && { totalMissions }),
      };
    }
  };

  walk(data, [], 0);
  if (percent === null && !saveTitle && !chapter && !missionProgress)
    return null;
  return {
    percent,
    saveTitle: saveTitle || chapter,
    ...(!saveTitle && chapter && { saveTitleKind: "chapter" as const }),
    ...(percent !== null && { progressKind: "story" as const }),
    ...(description && { missionDescription: description }),
    ...missionProgress,
  };
}

async function readMetadataFile(file: string, savedAt: number) {
  const ext = path.extname(file).slice(1).toLowerCase();

  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(MAX_METADATA_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_METADATA_BYTES || bytesRead === 0) return null;
    let bytes: Buffer = buffer.subarray(0, bytesRead);
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      bytes = gunzipSync(bytes, { maxOutputLength: MAX_METADATA_BYTES });
    }
    const encoding =
      bytes[0] === 0xff && bytes[1] === 0xfe
        ? "utf-16le"
        : bytes[0] === 0xfe && bytes[1] === 0xff
          ? "utf-16be"
          : "utf-8";
    const text = new TextDecoder(encoding, { fatal: true })
      .decode(bytes)
      .trimStart();
    const format = text.startsWith("{")
      ? "json"
      : text.startsWith("<")
        ? "xml"
        : ext === "ini" || /^\[[A-Za-z][^\]\r\n]{0,63}\]/.test(text)
          ? "ini"
          : null;
    if (!format) return null;
    const progress = parseGenericStoryMetadata(text, format);
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
        (SAVE_FILE_EXTENSION.test(entry.name) || ROCKSTAR_SLOT.test(entry.name))
      ) {
        files.push(file);
      }
    }
  }
  return files;
}
