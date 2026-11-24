import path from "node:path";
import { mkdir, writeFile, rename, readdir, unlink } from "node:fs/promises";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { AchievementMemoryStore } from "./achievements/achievement-memory-store";
import { hasTrackedGamesRunning } from "./game-running-state";

const interval = 24 * 60 * 60 * 1000;
let lastAttempt = 0;
let nextSuccessfulBackupDue = 0;
let busy = false;
const settings = db.sublevel<string, number>("krysta-backup-state", { valueEncoding: "json" });
const story = db.sublevel<string, unknown>("automatic-story-progress", { valueEncoding: "json" });
const history = db.sublevel<string, unknown>("achievement-scan-history", { valueEncoding: "json" });

export async function exportKrystaCloudBackup() {
  // Explicit opt-in: a user-selected, locally synchronized directory.
  const root = process.env.KRYSTA_BACKUP_FOLDER;
  if (!root || !path.isAbsolute(root) || busy || hasTrackedGamesRunning() || Date.now() < nextSuccessfulBackupDue || Date.now() - lastAttempt < 60_000) return;
  lastAttempt = Date.now();
  busy = true;
  try {
    const last = await settings.get("last-success").catch(() => undefined);
    if (last && Date.now() - last < interval) { nextSuccessfulBackupDue = last + interval; return; }
    const games: Array<{
      shop: string; objectId: string; title: string;
      collectionIds?: string[]; collectionPositions?: Record<string, number>;
      favorite?: boolean; isPinned?: boolean; playTimeInMilliseconds: number;
      achievements: {name: string; unlockTime: number; hardcoreUnlockTime?: number | null}[];
    }> = [];
    for (const game of await gamesSublevel.values().all()) {
      if (hasTrackedGamesRunning()) return;
      if (game.isDeleted) continue;
      games.push({
        shop: game.shop, objectId: game.objectId, title: game.title,
        collectionIds: game.collectionIds, collectionPositions: game.collectionPositions,
        favorite: game.favorite, isPinned: game.isPinned,
        playTimeInMilliseconds: game.playTimeInMilliseconds,
        achievements: (AchievementMemoryStore.get(game.shop, game.objectId)?.unlockedAchievements ?? []).map(a => ({
          name: a.name, unlockTime: a.unlockTime, hardcoreUnlockTime: a.hardcoreUnlockTime
        }))
      });
    }
    const preferences = await db.get<string, Record<string, unknown>>(levelKeys.userPreferences, { valueEncoding: "json" }).catch(() => undefined);
    const safePreferences = Object.fromEntries(Object.entries(preferences ?? {}).filter(([key, value]) =>
      ["language", "gameBoostEnabled", "enableSteamAchievements", "achievementNotificationsEnabled", "achievementSoundVolume", "screenshotsEnabled", "startMinimized", "launchToLibraryPage"].includes(key) &&
      ["string", "boolean", "number"].includes(typeof value)));
    const storyEntries = await story.iterator().all();
    const historyEntries = await history.iterator().all();
    if (hasTrackedGamesRunning()) return;
    const folder = path.join(root, "KrystaBackups");
    await mkdir(folder, { recursive: true });
    const name = "krysta-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
    const destination = path.join(folder, name);
    const payload = JSON.stringify({ version: 1, createdAt: Date.now(), games, preferences: safePreferences, story: storyEntries, history: historyEntries });
    await writeFile(destination + ".tmp", payload, { flag: "wx" });
    if (hasTrackedGamesRunning()) { await unlink(destination + ".tmp"); return; }
    await rename(destination + ".tmp", destination);
    const completedAt = Date.now();
    await settings.put("last-success", completedAt);
    nextSuccessfulBackupDue = completedAt + interval;
    const files = (await readdir(folder)).filter(n => /^krysta-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/.test(n)).sort().reverse();
    for (const file of files.slice(7)) {
      if (hasTrackedGamesRunning()) break;
      await unlink(path.join(folder, file)).catch(() => {});
    }
  } finally { busy = false; }
}
