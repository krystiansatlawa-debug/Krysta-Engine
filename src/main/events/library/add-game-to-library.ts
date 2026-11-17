import { registerEvent } from "../register-event";
import type { GameShop } from "@types";
import { createGame } from "@main/services/library-sync";
import {
  gamesShopAssetsSublevel,
  gamesShopCacheSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import { clearFinishedDownload } from "@main/helpers";
import { AchievementWatcherManager } from "@main/services/achievements/achievement-watcher-manager";
import { autoLinkKrystaGameExecutable } from "../krysta-executable-discovery";
import { logger } from "@main/services/logger";

const lookupCachedPlatform = async (
  shop: GameShop,
  objectId: string
): Promise<string | null> => {
  const prefix = `${shop}:${objectId}:`;
  try {
    const entries = await gamesShopCacheSublevel.iterator().all();
    for (const [key, value] of entries) {
      if (
        typeof key === "string" &&
        key.startsWith(prefix) &&
        value?.platform
      ) {
        return value.platform;
      }
    }
  } catch {
    return null;
  }
  return null;
};

const addGameToLibrary = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  title: string,
  platform?: string | null
) => {
  const gameKey = levelKeys.game(shop, objectId);
  let game = await gamesSublevel.get(gameKey);

  const gameAssets = await gamesShopAssetsSublevel.get(gameKey);

  const resolvedPlatform =
    platform ??
    (shop === "launchbox" ? await lookupCachedPlatform(shop, objectId) : null);

  if (game) {
    await clearFinishedDownload(shop, objectId);

    game.isDeleted = false;
    game.addedToLibraryAt ??= new Date();
    game.source = "hydra";
    if (shop === "epic") game.remoteId = null;
    if (resolvedPlatform && !game.platform) game.platform = resolvedPlatform;

    await gamesSublevel.put(gameKey, game);
  } else {
    game = {
      title,
      iconUrl: gameAssets?.iconUrl ?? null,
      libraryHeroImageUrl: gameAssets?.libraryHeroImageUrl ?? null,
      logoImageUrl: gameAssets?.logoImageUrl ?? null,
      objectId,
      shop,
      remoteId: null,
      isDeleted: false,
      playTimeInMilliseconds: 0,
      lastTimePlayed: null,
      addedToLibraryAt: new Date(),
      platform: resolvedPlatform ?? null,
      source: "hydra",
    };

    await gamesSublevel.put(gameKey, game);
  }

  if (game) {
    await createGame(game).catch(() => {});

    AchievementWatcherManager.syncGameAchievementFiles(
      game.shop,
      game.objectId
    );

    // Do not block adding a game while scanning its installation on disk.
    // Official Steam/Epic imports and manually assigned executables are protected.
    if (process.platform === "win32" && (game.shop === "steam" || game.shop === "epic" || game.shop === "custom")) {
      void autoLinkKrystaGameExecutable(game.shop, game.objectId).catch((error) =>
        logger.warn("Automatic game executable detection failed", {gameKey, error})
      );
    }
  }
};

registerEvent("addGameToLibrary", addGameToLibrary);
