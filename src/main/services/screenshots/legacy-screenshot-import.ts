import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { nativeImage } from "electron";
import { logger } from "../logger";
import { SCREENSHOT_CUSTOM_GAME_TITLE_MAX_LENGTH } from "@shared";
import { gamesSublevel } from "@main/level";
import type { Game, LocalScreenshot } from "@types";
import { LocalScreenshotStore } from "./local-screenshot-store";
import { getScreenshotFolderCandidates } from "./screenshots-folder";
import { getScreenshotsRoot, ensureRootMarkerId } from "./screenshots-root-marker";
import { getSignedInScreenshotOwnerId } from "./local-screenshot-owner";
import { toScreenshotFolderName } from "./screenshot-file-path";

const IMAGE_EXTENSION = /\.(jpe?g|png|webp)$/i;
const MAX_IMAGE_BYTES = 80 * 1024 * 1024;
const MAX_FILES = 10000;

const normalizeScreenshotPath = (filePath: string) => {
 const normalized = path.normalize(filePath);
 return process.platform === "win32" ? normalized.toLowerCase() : normalized;
};

const normalizeGameFolder = (value: string) =>
 value.normalize("NFKC").trim().replace(/[\s._-]+/g, " ").toLocaleLowerCase();

function matchGame(folderName: string, games: Game[]): Game | null {
 const normalizedFolder = normalizeGameFolder(folderName);
 const matches = games.filter(game =>
  !game.isDeleted && normalizeGameFolder(toScreenshotFolderName(game.title)) === normalizedFolder
 );
 // Never guess when multiple games have indistinguishable folder names.
 return matches.length === 1 ? matches[0] : null;
}

/** Import existing screenshots into Krysta's local gallery without copying or uploading them. */
export async function importLegacyScreenshots(): Promise<number> {
 const games = await gamesSublevel.values().all();
 const existing = await LocalScreenshotStore.listIncludingDeleted();
 const known = new Set(existing.map(item => normalizeScreenshotPath(item.path)));
 const existingByPath = new Map(existing.map(item => [normalizeScreenshotPath(item.path), item]));
 const ownerId = getSignedInScreenshotOwnerId();
 let imported = 0;
 let inspected = 0;
 for (const root of await getScreenshotFolderCandidates()) {
  const folders = await fs.readdir(root, { withFileTypes: true }).catch((error: unknown) => {
   if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
    logger.warn("Could not scan legacy screenshot root", { root, error });
   }
   return [];
  });
  for (const folder of folders) {
   if (inspected >= MAX_FILES) return imported;
   if (!folder.isDirectory() || folder.isSymbolicLink()) continue;
   const game = matchGame(folder.name, games);
   if (!game) continue;
   const directory = path.join(root, folder.name);
   const files = await fs.readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    logger.warn("Could not scan legacy screenshot game folder", { directory, error });
    return [];
   });
   for (const file of files) {
    if (!file.isFile() || file.isSymbolicLink() || !IMAGE_EXTENSION.test(file.name)) continue;
    if (++inspected > MAX_FILES) return imported;
    const filePath = path.join(directory, file.name);
    const key = normalizeScreenshotPath(filePath);
    if (known.has(key)) {
     const current = existingByPath.get(key);
     if (current && current.ownerId === ownerId && !current.objectId && current.state !== "deleted") {
      await LocalScreenshotStore.update(current.clientId, record =>
       record.objectId ? {} : { shop: game.shop, objectId: game.objectId, gameTitle: game.title }
      );
     }
     continue;
    }
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile() || stat.size === 0 || stat.size > MAX_IMAGE_BYTES) continue;
    let dimensions: { width: number; height: number };
    try {
     dimensions = nativeImage.createFromPath(filePath).getSize();
    } catch (error) {
     logger.warn("Could not read legacy screenshot image", { filePath, error });
     continue;
    }
    if (!dimensions.width || !dimensions.height) continue;
    const rootMarkerId = await ensureRootMarkerId(getScreenshotsRoot(filePath)).catch((error: unknown) => {
     logger.warn("Could not initialize legacy screenshot folder marker", { filePath, error });
     return null;
    });
    const screenshot: LocalScreenshot = {
     clientId: randomUUID(),
     ownerId,
     shop: game.shop,
     objectId: game.objectId,
     gameTitle: game.title,
     customGameTitle: game.shop === "custom" ? game.title.trim().slice(0, SCREENSHOT_CUSTOM_GAME_TITLE_MAX_LENGTH) : null,
     path: filePath,
     capturedAt: stat.mtimeMs,
     width: dimensions.width,
     height: dimensions.height,
     state: "local",
     isSpoiler: false,
     visibility: "PRIVATE",
     screenshotId: null,
     moderationStatus: null,
     moderationReason: null,
     uploadProgress: null,
     lastError: null,
     gameSessionId: null,
     rootMarkerId,
     previewPath: null,
    };
    try {
     // A capture may have been recorded while the folder scan was running.
     const latestRecords = await LocalScreenshotStore.listIncludingDeleted();
     const alreadySaved = latestRecords.some(record => normalizeScreenshotPath(record.path) === key);
     if (alreadySaved) {
      known.add(key);
      continue;
     }
     await LocalScreenshotStore.put(screenshot);
     known.add(key);
     imported++;
    } catch (error) {
     logger.warn("Could not import legacy screenshot", { filePath, error });
    }
   }
  }
 }
 return imported;
}
