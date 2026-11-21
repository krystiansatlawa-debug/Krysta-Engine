import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { nativeImage } from "electron";
import { logger } from "../logger";
import { SCREENSHOT_CUSTOM_GAME_TITLE_MAX_LENGTH } from "@shared";
import { gamesSublevel } from "@main/level";
import type { Game, LocalScreenshot } from "@types";
import { LocalScreenshotStore } from "./local-screenshot-store";
import { getPrivateScreenshotsFolder, getScreenshotFolderCandidates } from "./screenshots-folder";
import {
  getScreenshotsRoot,
  ensureRootMarkerId,
} from "./screenshots-root-marker";
import { getSignedInScreenshotOwnerId } from "./local-screenshot-owner";
import { toScreenshotFolderName } from "./screenshot-file-path";

const IMAGE_EXTENSION = /\.(jpe?g|png|webp)$/i;
const MAX_IMAGE_BYTES = 80 * 1024 * 1024;
const MAX_FILES = 50000;

const normalizeScreenshotPath = (filePath: string) => {
  const normalized = path.normalize(filePath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
};

const normalizeGameFolder = (value: string) =>
  value
    .normalize("NFKC")
    .trim()
    .replace(/[\s._-]+/g, " ")
    .toLocaleLowerCase();

function matchGame(folderName: string, games: Game[]): Game | null {
  const normalizedFolder = normalizeGameFolder(folderName);
  const matches = games.filter(
    (game) =>
      !game.isDeleted &&
      normalizeGameFolder(toScreenshotFolderName(game.title)) ===
        normalizedFolder
  );
  // Never guess when multiple games have indistinguishable folder names.
  return matches.length === 1 ? matches[0] : null;
}

/** Import existing screenshots into Krysta's local gallery without copying or uploading them. */
export async function importLegacyScreenshots(): Promise<number> {
  const games = await gamesSublevel.values().all();
  const existing = await LocalScreenshotStore.listIncludingDeleted();
  const known = new Set(
    existing.map((item) => normalizeScreenshotPath(item.path))
  );
  const existingByPath = new Map(
    existing.map((item) => [normalizeScreenshotPath(item.path), item])
  );
  const ownerId = getSignedInScreenshotOwnerId();
  let imported = 0;
  let inspected = 0;
  const selectedPrivateRoot = await getPrivateScreenshotsFolder();
  for (const root of await getScreenshotFolderCandidates()) {
    const isPrivateAlbum = !!selectedPrivateRoot &&
      normalizeScreenshotPath(root) === normalizeScreenshotPath(selectedPrivateRoot);
    const folders = await fs
      .readdir(root, { withFileTypes: true })
      .catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          logger.warn("Could not scan legacy screenshot root", { root, error });
        }
        return [];
      });
    const albumFolders: { name: string; directory: string; rootAlbum: boolean }[] = [];
    // Unsorted private screenshots in the folder root remain available under
    // "Nieprzypisane" instead of being silently ignored.
    if (isPrivateAlbum) albumFolders.push({
      name: "Nieprzypisane",
      directory: root,
      rootAlbum: true,
    });
    for (const folder of folders) {
      if (folder.isDirectory() && !folder.isSymbolicLink()) albumFolders.push({
        name: folder.name,
        directory: path.join(root, folder.name),
        rootAlbum: false,
      });
    }
    for (const folder of albumFolders) {
      if (inspected >= MAX_FILES) return imported;
      const game = folder.rootAlbum ? null : matchGame(folder.name, games);
      if (!game && !isPrivateAlbum) continue;
      const directory = folder.directory;
      const target = {
        shop: game?.shop ?? ("custom" as const),
        objectId: game?.objectId ?? "private-album-" +
          createHash("sha256").update(normalizeScreenshotPath(directory)).digest("hex").slice(0, 16),
        title: game?.title ?? folder.name,
      };
      const directoryEntries = await fs
        .readdir(directory, { withFileTypes: true })
        .catch((error: unknown) => {
          logger.warn("Could not scan legacy screenshot game folder", {
            directory,
            error,
          });
          return [];
        });
      // Also include nested albums in a game's private folder. Do not follow
      // links or scan unrelated folders outside of recognized game directories.
      const filePaths: string[] = [];
      for (const entry of directoryEntries) {
        if (entry.isFile() && !entry.isSymbolicLink())
          filePaths.push(path.join(directory, entry.name));
        if (folder.rootAlbum || !entry.isDirectory() || entry.isSymbolicLink()) continue;
        const nestedDirectory = path.join(directory, entry.name);
        const nestedEntries = await fs
          .readdir(nestedDirectory, { withFileTypes: true })
          .catch(() => []);
        for (const nested of nestedEntries) {
          if (nested.isFile() && !nested.isSymbolicLink())
            filePaths.push(path.join(nestedDirectory, nested.name));
        }
      }
      for (const filePath of filePaths) {
        if (!IMAGE_EXTENSION.test(filePath)) continue;
        if (++inspected > MAX_FILES) return imported;
        const key = normalizeScreenshotPath(filePath);
        if (known.has(key)) {
          const current = existingByPath.get(key);
          if (
            current &&
            current.ownerId === ownerId &&
            !current.objectId &&
            current.state !== "deleted"
          ) {
            await LocalScreenshotStore.update(current.clientId, (record) =>
              record.objectId
                ? {}
                : {
                    shop: target.shop,
                    objectId: target.objectId,
                    gameTitle: target.title,
                  }
            );
          }
          continue;
        }
        const stat = await fs.stat(filePath).catch(() => null);
        if (
          !stat ||
          !stat.isFile() ||
          stat.size === 0 ||
          stat.size > MAX_IMAGE_BYTES
        )
          continue;
        let dimensions: { width: number; height: number };
        try {
          dimensions = nativeImage.createFromPath(filePath).getSize();
        } catch (error) {
          logger.warn("Could not read legacy screenshot image", {
            filePath,
            error,
          });
          continue;
        }
        if (!dimensions.width || !dimensions.height) continue;
        const rootMarkerId = await ensureRootMarkerId(
          getScreenshotsRoot(filePath)
        ).catch((error: unknown) => {
          logger.warn("Could not initialize legacy screenshot folder marker", {
            filePath,
            error,
          });
          return null;
        });
        const screenshot: LocalScreenshot = {
          clientId: randomUUID(),
          ownerId,
          shop: target.shop,
          objectId: target.objectId,
          gameTitle: target.title,
          customGameTitle:
            target.shop === "custom"
              ? target.title.trim().slice(0, SCREENSHOT_CUSTOM_GAME_TITLE_MAX_LENGTH)
              : null,
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
          const latestRecords =
            await LocalScreenshotStore.listIncludingDeleted();
          const alreadySaved = latestRecords.some(
            (record) => normalizeScreenshotPath(record.path) === key
          );
          if (alreadySaved) {
            known.add(key);
            continue;
          }
          await LocalScreenshotStore.put(screenshot);
          known.add(key);
          imported++;
        } catch (error) {
          logger.warn("Could not import legacy screenshot", {
            filePath,
            error,
          });
        }
      }
    }
  }
  return imported;
}
