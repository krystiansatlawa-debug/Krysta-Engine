import fs from "node:fs/promises";
import path from "node:path";
import { ScreenshotService } from "@main/services/screenshot";
import { db, levelKeys } from "@main/level";
import type { GameShop, UserAchievement } from "@types";

const localSouvenirIndex = db.sublevel<string, string>("krysta-local-souvenir-index", { valueEncoding: "json" });
const localSouvenirs = db.sublevel<string, { screenshotPath: string; capturedAt: number; achievementNames: string[] }>("krysta-local-souvenirs", { valueEncoding: "json" });

export const attachLocalSouvenirs = async (items: UserAchievement[], shop: GameShop, objectId: string): Promise<UserAchievement[]> => {
  const gameKey = levelKeys.game(shop, objectId);
  const root = await ScreenshotService.getScreenshotsPath();
  const realRoot = await fs.realpath(root).catch(() => null);
  if (!realRoot) return items;
  const images = new Map<string, Promise<string | null>>();
  return Promise.all(items.map(async item => {
    if (!item.unlocked) return item;
    try {
      const entryKey = await localSouvenirIndex.get(JSON.stringify([gameKey, item.name.toUpperCase()]));
      if (!entryKey) return item;
      const entry = await localSouvenirs.get(entryKey);
      if (!entry || !entry.achievementNames.some(name => name.toUpperCase() === item.name.toUpperCase())) return item;
      if (!images.has(entryKey)) images.set(entryKey, (async () => {
        const real = await fs.realpath(entry.screenshotPath);
        const relative = path.relative(realRoot, real);
        if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !/\.jpe?g$/i.test(real)) return null;
        const stat = await fs.stat(real);
        if (!stat.isFile() || stat.size > 8 * 1024 * 1024) return null;
        const bytes = await fs.readFile(real);
        if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
        return "data:image/jpeg;base64," + bytes.toString("base64");
      })().catch(() => null));
      const imageUrl = await images.get(entryKey);
      return imageUrl ? { ...item, imageUrl } : item;
    } catch { return item; }
  }));
};

