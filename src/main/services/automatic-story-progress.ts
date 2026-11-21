import { app } from "electron";
import path from "node:path";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { getGameCatalogueIdentity } from "../../shared/library-catalogue";
import type {
  AutomaticGameStoryProgress,
  Game,
  GameStoryProgressView,
} from "@types";
import {
  hasTrackedGamesRunning,
  onTrackedGamesRunningChange,
} from "./game-running-state";
import { readHydraStorySave } from "./hydra-story-save-discovery";
import { discoverSelectedStorySaveFiles } from "./story-progress-metadata";
import { logger } from "./logger";
import { getSteamLibraryFolders } from "./steam";
import { getWinePrefixUserProfiles } from "./wine-prefix";
import { WindowManager } from "./window-manager";
import {
  identifyStorySaveSource,
  readDiscoveredStorySave,
  readLatestStorySave,
  storySaveSteamAppIds,
  type StorySaveScan,
  type StorySaveSource,
} from "./story-progress-save";

type CompletedScan = StorySaveScan & {
  installationKey?: string;
  saveObjectId?: string;
};
type PendingScan = {
  game: Game;
  source?: StorySaveSource;
  saveObjectId: string;
};

const snapshots = db.sublevel<
  string,
  AutomaticGameStoryProgress | CompletedScan
>("automatic-story-progress", { valueEncoding: "json" });
const customFolders = db.sublevel<string, string>(
  "story-save-folders",
  {
    valueEncoding: "json",
  }
);
const queued = new Map<string, PendingScan>();
let activeScan: { key: string; result: Promise<CompletedScan> } | undefined;
const canRead = () => !hasTrackedGamesRunning();

function storyKey(game: Game, source: StorySaveSource | undefined) {
  const { shop, objectId } = getGameCatalogueIdentity(game);
  return source ?? levelKeys.game(shop, objectId);
}

let sessionRevision = 0;
onTrackedGamesRunningChange(() => {
  sessionRevision++;
});

async function readStoredScan(key: string): Promise<CompletedScan> {
  const stored = await snapshots.get(key);
  if (stored && "status" in stored) return stored;
  if (stored) return { automatic: stored, status: "ready" };
  return { automatic: null, status: "not-found" };
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
  source: StorySaveSource | undefined,
  folder: string | undefined,
  canContinue: () => boolean
) {
  if (folder) {
    // Users can point any library game at its save directory, not just the
    // four formats with dedicated parsers.
    const recognized = source
      ? await readLatestStorySave(
          source,
          { profiles: [], directFolders: [folder] },
          canContinue
        )
      : null;
    if (recognized?.status === "ready" || recognized?.status === "waiting")
      return recognized;
    const files = await discoverSelectedStorySaveFiles(folder, canContinue);
    const detected = await readDiscoveredStorySave(files, source, canContinue);
    return detected.status === "not-found"
      ? (recognized ?? detected)
      : detected;
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
    if (!source || detected.status === "ready" || detected.status === "waiting")
      return detected;

    const paths = await defaultSavePaths(source, game, canContinue);
    const fallback = await readLatestStorySave(source, paths, canContinue);
    return fallback.status === "not-found" ? detected : fallback;
  } finally {
    unsubscribe();
  }
}

function refresh(key: string, scan: PendingScan) {
  queued.delete(key);
  const revision = sessionRevision;
  const canContinue = () => revision === sessionRevision && canRead();
  const retry = (previous: CompletedScan) => {
    if (!queued.has(key)) queued.set(key, scan);
    return previous;
  };
  const { game, source, saveObjectId } = scan;

  const result = (async () => {
    const previous = await readStoredScan(key);
    const folder =
      (await customFolders.get(key)) ??
      (source ? await customFolders.get(source) : undefined);
    if (!canContinue()) return retry(previous);
    const current = await readAutomaticSave(
      saveObjectId === game.objectId
        ? game
        : { ...game, objectId: saveObjectId },
      source,
      folder,
      canContinue
    ).catch((error: unknown): StorySaveScan => {
      logger.debug("Could not read story save", error);
      return { ...previous, status: "unreadable" };
    });
    if (!canContinue() || current.status === "waiting") return retry(previous);

    const catalogue = getGameCatalogueIdentity(game);
    const next: CompletedScan = {
      automatic: current.automatic,
      status: current.status,
      lastSaveAt: current.lastSaveAt,
      ...((catalogue.shop !== game.shop ||
        catalogue.objectId !== game.objectId) && {
        installationKey: levelKeys.game(game.shop, game.objectId),
      }),
      ...(saveObjectId !== game.objectId && { saveObjectId }),
    };
    if (JSON.stringify(next) !== JSON.stringify(previous))
      await snapshots.put(key, next);
    return next;
  })().finally(() => {
    activeScan = undefined;
    WindowManager.sendToAppWindows("on-game-story-progress-changed");
  });
  activeScan = { key, result };
  return result;
}

export function queueAutomaticStoryProgress(
  game: Game,
  saveObjectId = game.objectId
) {
  const source = identifyStorySaveSource(game);
  const key = storyKey(game, source);
  queued.set(key, { game, source, saveObjectId });
}

export function refreshQueuedStoryProgress() {
  if (activeScan || !canRead()) return;
  const next = queued.entries().next().value;
  if (next) {
    void refresh(...next).catch((error: unknown) => {
      logger.error("Could not save story progress", error);
    });
  }
}

export async function getAutomaticStoryProgress(
  game: Game,
  readSave: boolean
): Promise<Omit<GameStoryProgressView, "manual">> {
  const source = identifyStorySaveSource(game);
  const key = storyKey(game, source);
  let stored = await readStoredScan(key);

  if (readSave) {
    const installation = stored.installationKey
      ? await gamesSublevel.get(stored.installationKey)
      : undefined;
    const useInstallation =
      installation &&
      !installation.isDeleted &&
      storyKey(installation, identifyStorySaveSource(installation)) === key;
    const target = useInstallation ? installation : game;
    const scan = queued.get(key) ?? {
      game: target,
      source,
      saveObjectId:
        stored.installationKey && !useInstallation
          ? game.objectId
          : (stored.saveObjectId ?? target.objectId),
    };
    if (!canRead()) queued.set(key, scan);
    else if (activeScan?.key === key) stored = await activeScan.result;
    else if (activeScan) queued.set(key, scan);
    else stored = await refresh(key, scan);
  }

  return {
    automatic: stored.automatic,
    automaticStatus:
      queued.has(key) || activeScan?.key === key ? "waiting" : stored.status,
    lastSaveAt: stored.automatic?.savedAt ?? stored.lastSaveAt ?? null,
    hasCustomSaveFolder: !!(
      (await customFolders.get(key)) ??
      (source ? await customFolders.get(source) : undefined)
    ),
    canSelectSaveFolder: true,
  };
}

export async function setStorySaveFolder(game: Game, folder: string | null) {
  const source = identifyStorySaveSource(game);
  const key = storyKey(game, source);
  if (folder) await customFolders.put(key, folder);
  else {
    await customFolders.del(key);
    // Clear an older shared setting, if one was created before per-game paths.
    if (source) await customFolders.del(source);
  }
  queueAutomaticStoryProgress(game);
  if (activeScan?.key === key) await activeScan.result.catch(() => null);
  return getAutomaticStoryProgress(game, true);
}
