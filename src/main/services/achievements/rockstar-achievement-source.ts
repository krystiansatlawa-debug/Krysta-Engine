import { parseRockstarUnlockedAchievements, type RockstarUnlockedAchievement } from "./rockstar-achievement-parser";

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
