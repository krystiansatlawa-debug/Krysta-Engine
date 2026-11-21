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
  if (game.shop !== "launchbox") {
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
  ["complications", "story_summary_gta_complications"],
  ["chop", "story_summary_gta_chop"],
  ["fatherson", "story_summary_gta_father_son"],
  ["marriage counseling", "story_summary_gta_marriage"],
  ["the long stretch", "story_summary_gta_long_stretch"],
  ["friend request", "story_summary_gta_friend_request"],
  ["casing the jewel store", "story_summary_gta_casing"],
  ["the jewel store job", "story_summary_gta_jewel_job"],
  ["mr philips", "story_summary_gta_mr_philips"],
  ["nervous ron", "story_summary_gta_nervous_ron"],
  ["crystal maze", "story_summary_gta_crystal_maze"],
]);

const rdrSummaries: ReadonlyMap<string, string> = new Map([
  ["outlaws from the west", "story_summary_rdr_outlaws"],
  ["enter pursued by a memory", "story_summary_rdr_memory"],
  ["old friends", "story_summary_rdr_old_friends"],
  ["the aftermath of genesis", "story_summary_rdr_aftermath"],
  ["who the hell is leviticus cornwall", "story_summary_rdr_cornwall"],
  ["eastward bound", "story_summary_rdr_eastward"],
  ["polite society valentine style", "story_summary_rdr_valentine"],
  ["americans at rest", "story_summary_rdr_americans"],
  ["exit pursued by a bruised ego", "story_summary_rdr_bruised_ego"],
]);

const cyberpunkSummaries: ReadonlyMap<string, string> = new Map([
  ["the ripperdoc", "story_summary_cyber_ripperdoc"],
  ["the ride", "story_summary_cyber_ride"],
  ["the heist", "story_summary_cyber_heist"],
  ["love like fire", "story_summary_cyber_love_like_fire"],
  ["playing for time", "story_summary_cyber_playing_for_time"],
  ["automatic love", "story_summary_cyber_automatic_love"],
  ["ghost town", "story_summary_cyber_ghost_town"],
  ["down on the street", "story_summary_cyber_down_on_street"],
  ["search and destroy", "story_summary_cyber_search_destroy"],
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
    return {
      percent: null,
      saveTitle: title,
      summaryKey: cyberpunkSummaries.get(
        title.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").trim()
      ),
    };
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
  status: StorySaveStatus;
  lastSaveAt?: number;
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
    );
  const maxMetadataSize = 64 * 1024;
  for (const file of metadata) {
    const bytes = await readBounded(
      path.join(directory, file.name),
      maxMetadataSize + 1
    ).catch(() => null);
    if (!bytes || bytes.length > maxMetadataSize) continue;
    const details = parseCyberpunkStoryMetadata(
      bytes.toString("utf8").replace(/^\uFEFF/, "")
    );
    if (details) return details;
  }
  return null;
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
    ...(candidates[0] && { lastSaveAt: candidates[0].savedAt }),
  };
}

export async function readDiscoveredStorySave(
  files: readonly string[],
  source: StorySaveSource | undefined,
  canRead: ContinueReading
): Promise<StorySaveScan> {
  const scan = (format: StorySaveSource) =>
    readLatestStorySave(
      format,
      { profiles: [], detectedFiles: files },
      canRead
    );
  if (source) {
    const result = await scan(source);
    if (result.status !== "not-found") return result;
  }

  const formats = new Set<StorySaveSource>();
  let lastSaveAt: number | undefined;
  for (const file of new Set(files)) {
    if (!canRead()) return { automatic: null, status: "waiting" };
    if (!path.isAbsolute(file)) continue;
    const name = path.basename(file);
    if (rockstarSlotPattern("rdr2").test(name)) formats.add("rdr2");
    else if (rockstarSlotPattern("gtav").test(name)) formats.add("gtav");
    else if (
      name.toLowerCase() === "sav.dat" ||
      cyberpunkMetadataPattern.test(name)
    ) {
      formats.add("cyberpunk");
    }
    const savedAt = await fileTime(file);
    if (savedAt !== null && (lastSaveAt === undefined || savedAt > lastSaveAt))
      lastSaveAt = savedAt;
  }

  let progress: AutomaticGameStoryProgress | null = null;
  for (const format of source ? [] : formats) {
    const result = await scan(format);
    if (result.status === "waiting") return result;
    if (!result.automatic) continue;
    if (progress) return { automatic: null, status: "save-found", lastSaveAt };
    progress = result.automatic;
  }
  if (!canRead()) return { automatic: null, status: "waiting" };
  if (progress) return { automatic: progress, status: "ready" };
  return lastSaveAt === undefined
    ? { automatic: null, status: "not-found" }
    : { automatic: null, status: "save-found", lastSaveAt };
}
