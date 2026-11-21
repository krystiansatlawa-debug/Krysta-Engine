import { BrowserWindow, dialog } from "electron";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { db, gamesSublevel, levelKeys } from "@main/level";
import {
  getAutomaticStoryProgress,
  setStorySaveFolder,
} from "@main/services/automatic-story-progress";
import { getContextualEpicGame } from "@main/services/epic/import-visibility";
import { HydraApi } from "@main/services/hydra-api";
import { normalizeGameStoryProgress } from "../../../shared/game-story-progress";
import { getGameCatalogueIdentity } from "../../../shared/library-catalogue";
import type {
  GameShop,
  GameStoryProgress,
  GameStoryProgressView,
} from "@types";
import { registerEvent } from "../register-event";

const storyProgress = db.sublevel<string, GameStoryProgress>(
  "game-story-progress",
  { valueEncoding: "json" }
);

async function resolveStoryProgressGame(shop: GameShop, objectId: string) {
  if (
    (shop !== "steam" &&
      shop !== "epic" &&
      shop !== "custom" &&
      shop !== "launchbox") ||
    typeof objectId !== "string" ||
    !objectId
  ) {
    throw new Error("Invalid game identity");
  }

  const game = await gamesSublevel.get(levelKeys.game(shop, objectId));
  if (
    !game ||
    getContextualEpicGame(game, HydraApi.getAuthContext()).isDeleted
  ) {
    throw new Error("game/not-found-local");
  }

  const catalogueGame = getGameCatalogueIdentity(game);
  return {
    game,
    key: levelKeys.game(catalogueGame.shop, catalogueGame.objectId),
  };
}

registerEvent(
  "getGameStoryProgress",
  async (
    _event: Electron.IpcMainInvokeEvent,
    shop: GameShop,
    objectId: string,
    readSave = true
  ): Promise<GameStoryProgressView> => {
    const { game, key } = await resolveStoryProgressGame(shop, objectId);
    const [manual, automaticProgress] = await Promise.all([
      storyProgress.get(key),
      getAutomaticStoryProgress(game, readSave === true),
    ]);
    return { manual: manual ?? null, ...automaticProgress };
  },
  { jsonSafeResult: true }
);

registerEvent(
  "setGameStoryProgress",
  async (
    _event: Electron.IpcMainInvokeEvent,
    shop: GameShop,
    objectId: string,
    input: unknown
  ) => {
    const progress = normalizeGameStoryProgress(input);
    const { key } = await resolveStoryProgressGame(shop, objectId);

    if (progress) await storyProgress.put(key, progress);
    else await storyProgress.del(key);

    return progress;
  },
  { jsonSafeResult: true }
);

registerEvent(
  "selectStorySaveFolder",
  async (
    event: Electron.IpcMainInvokeEvent,
    shop: GameShop,
    objectId: string,
    reset = false
  ) => {
    const { game } = await resolveStoryProgressGame(shop, objectId);
    if (reset === true) return setStorySaveFolder(game, null);

    const options: Electron.OpenDialogOptions = {
      properties: ["openDirectory", "dontAddToRecent"],
    };
    const owner = BrowserWindow.fromWebContents(event.sender);
    const selection = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    const folder = selection.filePaths[0];
    if (selection.canceled || !folder) return null;
    if (!path.isAbsolute(folder)) throw new Error("Invalid save folder");
    const info = await lstat(folder);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error("Invalid save folder");

    const current = await resolveStoryProgressGame(shop, objectId);
    return setStorySaveFolder(current.game, await realpath(folder));
  },
  { jsonSafeResult: true }
);
