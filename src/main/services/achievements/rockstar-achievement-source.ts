import { parseRockstarUnlockedAchievements, type RockstarUnlockedAchievement } from "./rockstar-achievement-parser.js";

/** Rockstar Social Club title identifiers verified against the Galaxy integration.
 * Unmapped titles must not be queried using guessed identifiers.
 */
const titleIds: Readonly<Record<string, string>> = {
  "gtav-legacy": "gtav",
  "gtav-enhanced": "gtav",
  rdr2: "rdr2",
  gtaiv: "gtaiv",
  maxpayne3: "mp3",
  lanoire: "lan",
};

export function rockstarAchievementTitle(gameId: string): string | null {
  return Object.prototype.hasOwnProperty.call(titleIds, gameId)
    ? titleIds[gameId]
    : null;
}

/**
 * Network adapter only: caller supplies an authenticated, user-authorized
 * request function. No credentials, cookies or browser sessions are extracted.
 * A failed request rejects; it must never be interpreted as zero unlocks.
 */
export async function fetchRockstarAchievements(
  gameId: string,
  rockstarId: string,
  authorizedFetch: (url: string) => Promise<unknown>
): Promise<RockstarUnlockedAchievement[]> {
  const title = rockstarAchievementTitle(gameId);
  if (!title) throw new Error("Rockstar achievements not supported for this title");
  if (!/^[0-9]{1,20}$/.test(rockstarId))
    throw new Error("Invalid Rockstar account ID");
  const url = new URL("https://scapi.rockstargames.com/achievements/awardedAchievements");
  url.searchParams.set("title", title);
  url.searchParams.set("platform", "pc");
  url.searchParams.set("rockstarId", rockstarId);
  return parseRockstarUnlockedAchievements(await authorizedFetch(url.toString()));
}

/**
 * In-memory last-known-good snapshots. An API outage must never turn previously
 * unlocked achievements into an empty result. The caller can persist a verified
 * snapshot separately after successful retrieval.
 */
export class RockstarAchievementSync {
  private readonly snapshots = new Map<string, {
    items: RockstarUnlockedAchievement[];
    updatedAt: string;
  }>();

  getCached(gameId: string, rockstarId: string) {
    const snapshot = this.snapshots.get(`${rockstarId}:${gameId}`);
    return snapshot ? { ...snapshot, items: [...snapshot.items] } : null;
  }

  async sync(
    gameId: string,
    rockstarId: string,
    authorizedFetch: (url: string) => Promise<unknown>
  ) {
    const items = await fetchRockstarAchievements(gameId, rockstarId, authorizedFetch);
    const snapshot = { items, updatedAt: new Date().toISOString() };
    this.snapshots.set(`${rockstarId}:${gameId}`, snapshot);
    return { ...snapshot, items: [...items] };
  }

  clear() {
    this.snapshots.clear();
  }
}
