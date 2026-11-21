import { lstat, open, readdir } from "node:fs/promises";
import path from "node:path";
import type { AutomaticGameStoryProgress, Game, StorySaveStatus } from "@types";

export type StorySaveSource = "gtav" | "gtav-enhanced" | "rdr2" | "cyberpunk";

export const storySaveSteamAppIds: Readonly<Record<StorySaveSource, string>> = {
  gtav: "271590",
  "gtav-enhanced": "3240220",
  rdr2: "1174180",
  cyberpunk: "1091500",
};
const steamIds: ReadonlyMap<string, StorySaveSource> = new Map(
  Object.entries(storySaveSteamAppIds).map(([source, id]) => [
    id,
    source as StorySaveSource,
  ])
);

const rockstarIds: ReadonlyMap<string, StorySaveSource> = new Map([
  ["rockstar-gtav-legacy", "gtav"],
  ["rockstar-gtav-enhanced", "gtav-enhanced"],
  ["rockstar-rdr2", "rdr2"],
]);

const executables: ReadonlyMap<string, StorySaveSource> = new Map([
  ["gta5.exe", "gtav"],
  ["gta5_enhanced.exe", "gtav-enhanced"],
  ["rdr2.exe", "rdr2"],
  ["playrdr2.exe", "rdr2"],
  ["cyberpunk2077.exe", "cyberpunk"],
]);

const gameTitles: ReadonlyMap<string, StorySaveSource> = new Map([
  ["grand theft auto v", "gtav"],
  ["grand theft auto v legacy", "gtav"],
  ["grand theft auto v enhanced", "gtav-enhanced"],
  ["gta v", "gtav"],
  ["gta v legacy", "gtav"],
  ["gta v enhanced", "gtav-enhanced"],
  ["red dead redemption 2", "rdr2"],
  ["red dead redemption 2 ultimate edition", "rdr2"],
  ["rdr2", "rdr2"],
  ["cyberpunk 2077", "cyberpunk"],
  ["cyberpunk 2077 ultimate edition", "cyberpunk"],
]);

export function identifyStorySaveSource(
  game: Pick<
    Game,
    | "shop"
    | "objectId"
    | "catalogueGame"
    | "executablePath"
    | "trackingExecutablePaths"
  > &
    Partial<Pick<Game, "title">>
): StorySaveSource | undefined {
  for (const identity of [game.catalogueGame, game]) {
    if (!identity) continue;
    const known =
      identity.shop === "steam"
        ? steamIds.get(identity.objectId)
        : identity.shop === "custom" && rockstarIds.get(identity.objectId);
    if (known) return known;
  }

  const sources = new Set(
    [game.executablePath, ...(game.trackingExecutablePaths ?? [])]
      .map((file) =>
        executables.get(file?.split(/[\\/]/).pop()?.toLowerCase() ?? "")
      )
      .filter((source) => source !== undefined)
  );
  if (sources.size > 0) return sources.size === 1 ? [...sources][0] : undefined;
  if (game.shop === "epic" || game.shop === "custom") {
    const title = game.title
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    return gameTitles.get(title ?? "");
  }
  return undefined;
}

type SaveDetails = Omit<AutomaticGameStoryProgress, "savedAt">;

const gtaSummaries: ReadonlyMap<string, string> = new Map([
  ["prologue", "story_summary_gta_prologue"],
  ["prolog", "story_summary_gta_prologue"],
  ["franklin and lamar", "story_summary_gta_franklin"],
  ["franklin i lamar", "story_summary_gta_franklin"],
  ["repossession", "story_summary_gta_repossession"],
]);

const rdrSummaries: ReadonlyMap<string, string> = new Map([
  ["outlaws from the west", "story_summary_rdr_outlaws"],
  ["enter pursued by a memory", "story_summary_rdr_memory"],
]);

const rockstarHeaderSize = 260;

export function parseRockstarStoryHeader(
  bytes: Buffer,
  source: Exclude<StorySaveSource, "cyberpunk">
): SaveDetails | null {
  // PC save headers contain a big-endian version and a UTF-16LE display title.
  // The encrypted body is not needed for the total completion shown here.
  if (
    bytes.length < rockstarHeaderSize ||
    bytes.readUInt32BE(0) !== (source === "rdr2" ? 4 : 1)
  )
    return null;

  const header = bytes.subarray(4, rockstarHeaderSize).toString("utf16le");
  const title = header.split("\u0000", 1)[0];
  const match =
    /^(?<name>.+?)\s*\((?<percent>\d{1,3}(?:[.,]\d{1,2})?)\s*%\)(?:\s*[-–—]\s*\S[^\r\n]*)?$/iu.exec(
      title
    );
  if (!match?.groups) return null;

  const percent = Number(match.groups.percent.replace(",", "."));
  const saveTitle = match.groups.name.replace(/^\(autosave\)\s*/i, "").trim();
  if (percent > 100 || !saveTitle || /[\p{Cc}\uFFFD]/u.test(saveTitle))
    return null;

  const normalized = saveTitle.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "");
  const summaries = source === "rdr2" ? rdrSummaries : gtaSummaries;
  return { percent, saveTitle, summaryKey: summaries.get(normalized) };
}

export function parseCyberpunkStoryMetadata(json: string): SaveDetails | null {
  type ParsedMetadata = {
    Data?: {
      metadata?: { trackedQuest?: unknown; trackedQuestEntry?: unknown };
    };
  };
  let parsed: ParsedMetadata | null;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const data = parsed?.Data?.metadata;
  if (!data) return null;

  const title =
    typeof data.trackedQuest === "string" ? data.trackedQuest.trim() : "";
  const entry =
    typeof data.trackedQuestEntry === "string" ? data.trackedQuestEntry : "";
  const trackedQuestId =
    /(?:^|[/\\])((?:(?:q|mq|sq)\d{3}|sts_)[a-z0-9_]{0,56})(?=[/\\.#]|$)/i
      .exec(entry)?.[1]
      ?.toLowerCase();
  if (title === "LocKey#98600" || trackedQuestId === "mq062_clampdown") {
    return {
      percent: null,
      saveTitle: "Clampdown",
      summaryKey: "story_summary_cyber_clampdown",
    };
  }
  if (trackedQuestId === "q004_braindance") {
    return {
      percent: null,
      saveTitle: "The Information",
      summaryKey: "story_summary_cyber_information",
    };
  }
  if (
    title &&
    !/^LocKey#|^None$/i.test(title) &&
    title.length <= 160 &&
    !/[\p{Cc}\uFFFD]/u.test(title)
  ) {
    return { percent: null, saveTitle: title };
  }
  const questId =
    trackedQuestId ??
    (/^LocKey#[1-9]\d{0,19}$/i.test(title) ? title : undefined);
  return questId
    ? { percent: null, saveTitle: "", trackedQuestId: questId }
    : null;
}

type ContinueReading = () => boolean;
type SaveCandidate = { file: string; savedAt: number };
export type StorySaveScan = {
  automatic: AutomaticGameStoryProgress | null;
  status: Extract<
    StorySaveStatus,
    "ready" | "not-found" | "unreadable" | "waiting"
  >;
};

async function listDirectory(directory: string) {
  return readdir(directory, { withFileTypes: true }).catch(() => []);
}

async function fileTime(file: string) {
  const info = await lstat(file).catch(() => null);
  return info?.isFile() ? info.mtimeMs : null;
}

async function readBounded(file: string, limit: number) {
  const handle = await open(file, "r");
  try {
    const bytes = Buffer.alloc(limit);
    const { bytesRead } = await handle.read(bytes, 0, limit, 0);
    return bytes.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

const rockstarFolders = {
  gtav: ["GTA V", "GTAV"],
  "gtav-enhanced": ["GTAV Enhanced", "GTA V Enhanced"],
  rdr2: ["Red Dead Redemption 2"],
};

const rockstarSlotPattern = (source: keyof typeof rockstarFolders) =>
  source === "rdr2" ? /^SRDR3\d{4}$/i : /^SGTA5\d{4}$/i;

const cyberpunkMetadataPattern = /^metadata\.\d+\.json$/i;

async function findRockstarSlots(
  source: keyof typeof rockstarFolders,
  roots: string[],
  canRead: ContinueReading
) {
  const slot = rockstarSlotPattern(source);
  const candidates: SaveCandidate[] = [];
  const visited = new Set<string>();
  for (const root of roots) {
    if (!canRead()) break;
    const directories = [root];
    for (const entry of await listDirectory(root)) {
      if (entry.isDirectory()) directories.push(path.join(root, entry.name));
    }
    const profiles = path.join(root, "Profiles");
    for (const entry of await listDirectory(profiles)) {
      if (entry.isDirectory())
        directories.push(path.join(profiles, entry.name));
    }
    for (const directory of directories) {
      if (!canRead()) return candidates;
      if (visited.has(directory)) continue;
      visited.add(directory);
      for (const entry of await listDirectory(directory)) {
        if (!canRead()) return candidates;
        if (!entry.isFile() || !slot.test(entry.name)) continue;
        const file = path.join(directory, entry.name);
        const savedAt = await fileTime(file);
        if (savedAt !== null) candidates.push({ file, savedAt });
      }
    }
  }
  return candidates;
}

async function findCyberpunkSlots(roots: string[], canRead: ContinueReading) {
  const candidates: SaveCandidate[] = [];
  for (const root of roots) {
    if (!canRead()) break;
    const slots = [root];
    for (const entry of await listDirectory(root)) {
      if (
        entry.isDirectory() &&
        /^(?:ManualSave|AutoSave|QuickSave|PointOfNoReturnSave|EndGameSave)-\d+$/i.test(
          entry.name
        )
      ) {
        slots.push(path.join(root, entry.name));
      }
    }
    for (const file of slots) {
      if (!canRead()) return candidates;
      const savedAt = await fileTime(path.join(file, "sav.dat"));
      if (savedAt !== null) candidates.push({ file, savedAt });
    }
  }
  return candidates;
}

async function readCyberpunkSlot(directory: string) {
  const metadata = (await listDirectory(directory))
    .filter(
      (entry) => entry.isFile() && cyberpunkMetadataPattern.test(entry.name)
    )
    .sort(
      (a, b) => Number(b.name.split(".")[1]) - Number(a.name.split(".")[1])
    )[0];
  if (!metadata) return null;
  const maxMetadataSize = 64 * 1024;
  const bytes = await readBounded(
    path.join(directory, metadata.name),
    maxMetadataSize + 1
  );
  if (bytes.length > maxMetadataSize) return null;
  return parseCyberpunkStoryMetadata(
    bytes.toString("utf8").replace(/^\uFEFF/, "")
  );
}

async function findDetectedSlots(
  source: StorySaveSource,
  files: readonly string[],
  canRead: ContinueReading
) {
  const candidates: SaveCandidate[] = [];
  const visited = new Set<string>();
  for (const file of files) {
    if (!canRead()) break;
    if (!path.isAbsolute(file)) continue;
    const name = path.basename(file);
    if (source === "cyberpunk") {
      if (
        name.toLowerCase() !== "sav.dat" &&
        !cyberpunkMetadataPattern.test(name)
      )
        continue;
    } else if (!rockstarSlotPattern(source).test(name)) {
      continue;
    }
    const candidate = source === "cyberpunk" ? path.dirname(file) : file;
    if (visited.has(candidate)) continue;
    visited.add(candidate);
    const savedAt = await fileTime(
      source === "cyberpunk" ? path.join(candidate, "sav.dat") : candidate
    );
    if (savedAt !== null) candidates.push({ file: candidate, savedAt });
  }
  return candidates;
}

export async function readLatestStorySave(
  source: StorySaveSource,
  paths: {
    profiles: { home: string; documents: string }[];
    directFolders?: string[];
    detectedFiles?: readonly string[];
  },
  canRead: ContinueReading
): Promise<StorySaveScan> {
  const waiting: StorySaveScan = { automatic: null, status: "waiting" };
  if (!canRead()) return waiting;

  const defaults = paths.profiles.flatMap(({ home, documents }) =>
    source === "cyberpunk"
      ? [path.join(home, "Saved Games", "CD Projekt Red", "Cyberpunk 2077")]
      : rockstarFolders[source].map((folder) =>
          path.join(documents, "Rockstar Games", folder)
        )
  );
  const roots = [...new Set([...defaults, ...(paths.directFolders ?? [])])];
  const candidates = paths.detectedFiles
    ? await findDetectedSlots(source, paths.detectedFiles, canRead)
    : source === "cyberpunk"
      ? await findCyberpunkSlots(roots, canRead)
      : await findRockstarSlots(source, roots, canRead);

  if (!canRead()) return waiting;
  candidates.sort((a, b) => b.savedAt - a.savedAt);
  for (const { file, savedAt } of candidates) {
    if (!canRead()) return waiting;
    try {
      const details =
        source === "cyberpunk"
          ? await readCyberpunkSlot(file)
          : parseRockstarStoryHeader(
              await readBounded(file, rockstarHeaderSize),
              source
            );
      if (!canRead()) return waiting;
      if (details)
        return { automatic: { ...details, savedAt }, status: "ready" };
    } catch {
      // Continue to the next slot if this one was removed, incomplete or inaccessible.
    }
  }
  return {
    automatic: null,
    status: candidates.length ? "unreadable" : "not-found",
  };
}
