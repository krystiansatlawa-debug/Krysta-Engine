import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { gamesSublevel } from "@main/level";
import { resolveManualScreenshotPath } from "./screenshot-file-path";
import { getDefaultScreenshotsFolder, getScreenshotFolderCandidates } from "./screenshots-folder";
import { LocalScreenshotStore } from "./local-screenshot-store";
import { logger } from "../logger";
import type { Game, LocalScreenshot } from "@types";

// Rebuild missing *local* gallery metadata from the folders used by Krysta /
// older Hydra installs. Do not recurse into unknown folders or import files
// outside a uniquely identified game directory.
const MAX_DIRECTORIES = 500;
const MAX_FILES_PER_DIRECTORY = 400;
const MAX_IMPORTED_PER_SCAN = 400;
const RESCAN_MS = 15_000;
let lastScan = 0;
let running: Promise<void> | null = null;

const keyOfPath = (file: string) =>
  process.platform === "win32" ? path.normalize(file).toLowerCase() : path.normalize(file);

const gameFolder = (title: string) =>
  path.basename(path.dirname(resolveManualScreenshotPath("screenshots", title, new Date(0))));

async function scan() {
  const games = await gamesSublevel.values().all();
  const byFolder = new Map<string, Game | null>();
  for (const game of games) {
    if (game.isDeleted || !game.title || !["steam", "epic", "custom"].includes(game.shop)) continue;
    const name = gameFolder(game.title).toLowerCase();
    if (!name) continue;
    const existing = byFolder.get(name);
    if (existing === undefined) byFolder.set(name, game);
    else if (existing.shop !== game.shop || existing.objectId !== game.objectId)
      byFolder.set(name, null); // ambiguous title: never misassign screenshots
  }

  const existing = await LocalScreenshotStore.listIncludingDeleted();
  const known = new Set(existing.map((item) => keyOfPath(item.path)));
  const pictures = path.dirname(getDefaultScreenshotsFolder());
  const roots = [...new Set([
    ...await getScreenshotFolderCandidates(),
    path.join(pictures, "Krysta"),
    path.join(pictures, "Krysta Launcher"),
  ])];
  let imported = 0;

  for (const root of roots) {
    if (imported >= MAX_IMPORTED_PER_SCAN) break;
    const rootStat = await fs.lstat(root).catch(() => null);
    if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) continue;
    const directories = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const directory of directories.slice(0, MAX_DIRECTORIES)) {
      if (imported >= MAX_IMPORTED_PER_SCAN) break;
      if (!directory.isDirectory() || directory.isSymbolicLink()) continue;
      const game = byFolder.get(directory.name.toLowerCase());
      if (!game) continue;
      const folder = path.join(root, directory.name);
      const files = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
      for (const entry of files.slice(0, MAX_FILES_PER_DIRECTORY)) {
        if (imported >= MAX_IMPORTED_PER_SCAN) break;
        if (!entry.isFile() || entry.isSymbolicLink() || !/\.(?:jpe?g|png)$/i.test(entry.name)) continue;
        const file = path.join(folder, entry.name);
        const key = keyOfPath(file);
        if (known.has(key)) continue;
        const stat = await fs.lstat(file).catch(() => null);
        if (!stat?.isFile() || stat.isSymbolicLink() || stat.size < 4 || stat.size > 100 * 1024 * 1024) continue;
        const screenshot: LocalScreenshot = {
          clientId: randomUUID(),
          ownerId: null,
          shop: game.shop,
          objectId: game.objectId,
          gameTitle: game.title,
          customGameTitle: game.shop === "custom" ? game.title.slice(0, 100) : null,
          path: file,
          capturedAt: stat.mtimeMs,
          width: 0,
          height: 0,
          state: "local",
          isSpoiler: false,
          visibility: "PRIVATE",
          screenshotId: null,
          gameSessionId: null,
          moderationStatus: null,
          moderationReason: null,
          uploadProgress: null,
          lastError: null,
          previewPath: null,
        };
        await LocalScreenshotStore.put(screenshot);
        known.add(key);
        imported++;
      }
    }
  }
  if (imported) logger.info("Recovered local game screenshots from disk", { imported });
}

export function recoverGameScreenshotsFromDisk(): Promise<void> {
  if (running) return running;
  if (Date.now() - lastScan < RESCAN_MS) return Promise.resolve();
  running = scan()
    .catch((error) => logger.warn("Could not recover local screenshots", error))
    .finally(() => { lastScan = Date.now(); running = null; });
  return running;
}
