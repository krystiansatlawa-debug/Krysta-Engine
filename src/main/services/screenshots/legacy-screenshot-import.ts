import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { nativeImage } from "electron";
import { gamesSublevel } from "@main/level";
import type { Game, LocalScreenshot } from "@types";
import { LocalScreenshotStore } from "./local-screenshot-store";
import { getScreenshotFolderCandidates } from "./screenshots-folder";
import { getScreenshotsRoot } from "./screenshots-root-marker";
import { readRootMarkerId } from "./screenshots-root-marker";
import { getSignedInScreenshotOwnerId } from "./local-screenshot-owner";
import { toScreenshotFolderName } from "./screenshot-file-path";

const IMAGE_EXTENSION = /\.(jpe?g|png|webp)$/i;
const MAX_IMAGE_BYTES = 80 * 1024 * 1024;
const MAX_FILES = 10000;

function matchGame(folderName: string, games: Game[]): Game | null {
 const matches = games.filter(game =>
  !game.isDeleted && toScreenshotFolderName(game.title).toLowerCase() === folderName.toLowerCase()
 );
 return matches.length === 1 ? matches[0] : null;
}

/** Import existing screenshots into Krysta's local gallery without copying or uploading them. */
export async function importLegacyScreenshots(): Promise<number> {
 const games = await gamesSublevel.values().all();
 const existing = await LocalScreenshotStore.listIncludingDeleted();
 const known = new Set(existing.map(item => path.normalize(item.path).toLowerCase()));
 const ownerId = getSignedInScreenshotOwnerId();
 let imported = 0;
 let inspected = 0;
 for (const root of await getScreenshotFolderCandidates()) {
  const folders = await fs.readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
   if (error.code === "ENOENT") return [];
   throw error;
  });
  for (const folder of folders) {
   if (!folder.isDirectory() || folder.isSymbolicLink()) continue;
   const game = matchGame(folder.name, games);
   if (!game) continue;
   const directory = path.join(root, folder.name);
   const files = await fs.readdir(directory, { withFileTypes: true });
   for (const file of files) {
    if (++inspected > MAX_FILES) return imported;
    if (!file.isFile() || file.isSymbolicLink() || !IMAGE_EXTENSION.test(file.name)) continue;
    const filePath = path.join(directory, file.name);
    const key = path.normalize(filePath).toLowerCase();
    if (known.has(key)) continue;
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile() || stat.size === 0 || stat.size > MAX_IMAGE_BYTES) continue;
    const dimensions = nativeImage.createFromPath(filePath).getSize();
    if (!dimensions.width || !dimensions.height) continue;
    const screenshot: LocalScreenshot = {
     clientId: randomUUID(),
     ownerId,
     shop: game.shop,
     objectId: game.objectId,
     gameTitle: game.title,
     customGameTitle: null,
     path: filePath,
     capturedAt: stat.mtimeMs,
     width: dimensions.width,
     height: dimensions.height,
     state: "local",
     isSpoiler: false,
     visibility: "private",
     screenshotId: null,
     moderationStatus: null,
     moderationReason: null,
     uploadProgress: null,
     lastError: null,
     gameSessionId: null,
     rootMarkerId: await readRootMarkerId(getScreenshotsRoot(filePath)),
     previewPath: null,
    };
    await LocalScreenshotStore.put(screenshot);
    known.add(key);
    imported++;
   }
  }
 }
 return imported;
}
