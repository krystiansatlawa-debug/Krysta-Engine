import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import type { RockstarUnlockedAchievement } from "./rockstar-achievement-parser";

type Snapshot = { items: RockstarUnlockedAchievement[]; updatedAt: string };
type CacheFile = { version: 1; accountId: string; games: Record<string, Snapshot> };

/**
 * Disk cache for already verified Rockstar achievement snapshots.
 * Account scoped; malformed or interrupted writes cannot erase valid data.
 * Contains no authentication tokens.
 */
export class RockstarAchievementDiskCache {
  constructor(private readonly filename: string) {}

  async read(accountId: string, gameId: string): Promise<Snapshot | null> {
    const file = await this.load(accountId);
    const snapshot = file.games[gameId];
    if (!snapshot || !Array.isArray(snapshot.items) ||
        !Number.isFinite(Date.parse(snapshot.updatedAt))) return null;
    if (!snapshot.items.every(item => item &&
      typeof item.id === "string" &&
      (item.unlockedAt === null || typeof item.unlockedAt === "string"))) return null;
    return { items: snapshot.items.map(item => ({ ...item })), updatedAt: snapshot.updatedAt };
  }

  async save(accountId: string, gameId: string, snapshot: Snapshot): Promise<void> {
    if (!/^[0-9]{1,20}$/.test(accountId) || !/^[a-z0-9-]{1,80}$/.test(gameId))
      throw new Error("Invalid Rockstar cache key");
    const current = await this.load(accountId);
    current.games[gameId] = { items: snapshot.items.map(item => ({ ...item })), updatedAt: snapshot.updatedAt };
    await mkdir(path.dirname(this.filename), { recursive: true });
    const temp = this.filename + ".tmp";
    await writeFile(temp, JSON.stringify(current), { mode: 0o600 });
    await rename(temp, this.filename);
  }

  private async load(accountId: string): Promise<CacheFile> {
    if (!/^[0-9]{1,20}$/.test(accountId)) throw new Error("Invalid Rockstar account ID");
    const empty: CacheFile = { version: 1, accountId, games: {} };
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filename, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return empty;
      const candidate = parsed as Partial<CacheFile>;
      if (candidate.version !== 1 || candidate.accountId !== accountId ||
          !candidate.games || typeof candidate.games !== "object" || Array.isArray(candidate.games))
        return empty;
      return candidate as CacheFile;
    } catch {
      return empty;
    }
  }
}
