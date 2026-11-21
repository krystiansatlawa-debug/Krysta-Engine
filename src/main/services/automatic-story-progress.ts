import { app } from "electron";
import path from "node:path";
import { db } from "@main/level";
import type {
  AutomaticGameStoryProgress,
  Game,
  GameStoryProgressView,
  StorySaveStatus,
} from "@types";
import {
  hasTrackedGamesRunning,
  onTrackedGamesRunningChange,
} from "./game-running-state";
import { readHydraStorySave } from "./hydra-story-save-discovery";
import { logger } from "./logger";
import { getSteamLibraryFolders } from "./steam";
import { getWinePrefixUserProfiles } from "./wine-prefix";
import { WindowManager } from "./window-manager";
import {
  identifyStorySaveSource,
  readLatestStorySave,
  storySaveSteamAppIds,
  type StorySaveSource,
} from "./story-progress-save";

const snapshots = db.sublevel<StorySaveSource, AutomaticGameStoryProgress>(
  "automatic-story-progress",
  { valueEncoding: "json" }
);
const customFolders = db.sublevel<StorySaveSource, string>(
  "story-save-folders",
  {
    valueEncoding: "json",
  }
);
const queued = new Map<StorySaveSource, Game>();
const statuses = new Map<StorySaveSource, StorySaveStatus>();
const inFlight = new Map<
  StorySaveSource,
  Promise<AutomaticGameStoryProgress | null>
>();
const canRead = () => !hasTrackedGamesRunning();
let sessionRevision = 0;
onTrackedGamesRunningChange(() => {
  sessionRevision++;
});

function enqueue(source: StorySaveSource, game: Game) {
  queued.set(source, game);
  statuses.set(source, "waiting");
}

async function defaultSavePaths(
  source: StorySaveSource,
  game: Game,
  canContinue: () => boolean
) {
  const home = app.getPath("home");
  const profiles: { home: string; documents: string }[] = [];
  const directFolders: string[] = [];
  const epicPath = game.epicInstallation?.savePath;
  if (epicPath && path.isAbsolute(epicPath)) directFolders.push(epicPath);

  if (process.platform === "win32") {
    profiles.push({ home, documents: app.getPath("documents") });
    profiles.push({ home, documents: path.join(home, "Documents") });
    const oneDrive = process.env.OneDrive;
    if (oneDrive && path.isAbsolute(oneDrive)) {
      profiles.push({ home, documents: path.join(oneDrive, "Documents") });
    }
  } else if (process.platform === "linux") {
    const prefixes = (await getSteamLibraryFolders()).map((root) =>
      path.join(
        root,
        "steamapps",
        "compatdata",
        storySaveSteamAppIds[source],
        "pfx"
      )
    );
    if (game.winePrefixPath) {
      prefixes.unshift(
        game.winePrefixPath.startsWith("~/")
          ? path.join(home, game.winePrefixPath.slice(2))
          : game.winePrefixPath
      );
    }
    for (const prefix of new Set(prefixes)) {
      if (!canContinue()) break;
      if (!path.isAbsolute(prefix)) continue;
      for (const name of getWinePrefixUserProfiles(prefix, home)) {
        const user = path.join(prefix, "drive_c", "users", name);
        profiles.push({ home: user, documents: path.join(user, "Documents") });
        profiles.push({
          home: user,
          documents: path.join(user, "My Documents"),
        });
      }
    }
  } else if (process.platform === "darwin" && source === "cyberpunk") {
    directFolders.push(
      path.join(
        app.getPath("appData"),
        "CD Projekt Red",
        "Cyberpunk 2077",
        "Saves"
      )
    );
  }
  return { profiles, directFolders };
}

async function readAutomaticSave(
  game: Game,
  source: StorySaveSource,
  folder: string | undefined,
  canContinue: () => boolean
) {
  if (folder) {
    return readLatestStorySave(
      source,
      { profiles: [], directFolders: [folder] },
      canContinue
    );
  }

  const controller = new AbortController();
  const unsubscribe = onTrackedGamesRunningChange(() => controller.abort());
  try {
    const detected = await readHydraStorySave(
      game,
      source,
      canContinue,
      controller.signal
    );
    if (detected.status === "ready" || detected.status === "waiting")
      return detected;

    const paths = await defaultSavePaths(source, game, canContinue);
    const fallback = await readLatestStorySave(source, paths, canContinue);
    return fallback.status === "not-found" ? detected : fallback;
  } finally {
    unsubscribe();
  }
}

function refresh(source: StorySaveSource, game: Game) {
  const existing = inFlight.get(source);
  if (existing) return existing;
  queued.delete(source);

  const lookup = (async () => {
    const previous = (await snapshots.get(source)) ?? null;
    if (!canRead()) {
      enqueue(source, game);
      return previous;
    }
    const revision = sessionRevision;
    const canContinue = () => revision === sessionRevision && canRead();
    const folder = await customFolders.get(source);
    if (!canContinue()) {
      enqueue(source, game);
      return previous;
    }
    const result = await readAutomaticSave(
      game,
      source,
      folder,
      canContinue
    ).catch((error: unknown) => {
      logger.debug("Could not read story save", error);
      return { automatic: previous, status: "unreadable" } as const;
    });
    if (!canContinue()) {
      enqueue(source, game);
      return previous;
    }
    const next = result.automatic;
    const changed = JSON.stringify(next) !== JSON.stringify(previous);
    const statusChanged = statuses.get(source) !== result.status;
    if (changed) {
      if (next) await snapshots.put(source, next);
      else await snapshots.del(source);
    }
    statuses.set(source, result.status);
    if (changed || statusChanged) {
      WindowManager.sendToAppWindows("on-game-story-progress-changed");
    }
    return next;
  })().finally(() => {
    inFlight.delete(source);
  });
  inFlight.set(source, lookup);
  return lookup;
}

export function queueAutomaticStoryProgress(game: Game) {
  const source = identifyStorySaveSource(game);
  if (source) enqueue(source, game);
}

export function refreshQueuedStoryProgress() {
  if (!queued.size || !canRead()) return;
  for (const [source, game] of queued) {
    if (inFlight.has(source)) continue;
    void refresh(source, game).catch((error: unknown) => {
      logger.error("Could not save story progress", error);
    });
  }
}

export async function getAutomaticStoryProgress(
  game: Game,
  readSave: boolean
): Promise<Omit<GameStoryProgressView, "manual">> {
  const source = identifyStorySaveSource(game);
  if (!source)
    return {
      automatic: null,
      automaticStatus: "unsupported",
      hasCustomSaveFolder: false,
    };

  if (readSave && !canRead()) enqueue(source, game);
  const automatic =
    readSave && canRead()
      ? await refresh(source, game)
      : ((await snapshots.get(source)) ?? null);
  return {
    automatic,
    automaticStatus: queued.has(source)
      ? "waiting"
      : (statuses.get(source) ?? (automatic ? "ready" : "not-found")),
    hasCustomSaveFolder: !!(await customFolders.get(source)),
  };
}

export async function setStorySaveFolder(game: Game, folder: string | null) {
  const source = identifyStorySaveSource(game);
  if (!source) throw new Error("Story save format is unsupported");
  if (folder) await customFolders.put(source, folder);
  else await customFolders.del(source);
  await inFlight.get(source)?.catch(() => null);
  return getAutomaticStoryProgress(game, true);
}
