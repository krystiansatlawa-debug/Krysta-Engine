import {
  parseRockstarAwardedAchievements,
  type RockstarAward,
} from "./rockstar-achievement-data.js";

/**
 * Read-only access to the Rockstar Social Club achievements endpoint.
 * The caller must obtain a valid user-authorized token through a supported
 * Rockstar login. This client does not request passwords or persist tokens.
 */
export const rockstarAchievementTitles = {
  "gtav-legacy": "gtav",
  "gtav-enhanced": "gtav",
  rdr2: "rdr2",
  gtaiv: "gta4",
  maxpayne3: "mp3",
  lanoire: "lan",
} as const;

export type RockstarAchievementTitle = keyof typeof rockstarAchievementTitles;

export async function fetchRockstarAwardedAchievements(
  title: RockstarAchievementTitle,
  rockstarId: string,
  bearerToken: string,
  request: typeof fetch = fetch
): Promise<RockstarAward[]> {
  if (!/^[0-9]{1,20}$/.test(rockstarId))
    throw Error("Invalid Rockstar account identifier");
  if (!bearerToken || bearerToken.length > 8192 || /[\r\n]/.test(bearerToken))
    throw Error("Invalid Rockstar authentication");
  const titleId = rockstarAchievementTitles[title];
  if (!titleId) throw Error("Unsupported Rockstar achievement title");

  const url = new URL(
    "https://scapi.rockstargames.com/achievements/awardedAchievements"
  );
  url.searchParams.set("title", titleId);
  url.searchParams.set("platform", "pc");
  url.searchParams.set("rockstarId", rockstarId);

  const response = await request(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${bearerToken}`, Accept: "application/json" },
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });

  if (response.status === 401 || response.status === 403)
    throw Error("Rockstar login expired or access denied");
  if (!response.ok)
    throw Error(`Rockstar achievements unavailable (HTTP ${response.status})`);
  const declaredType = response.headers.get("content-type") ?? "";
  if (!declaredType.includes("json"))
    throw Error("Rockstar response is not JSON");
  const raw = await response.text();
  if (raw.length > 1024 * 1024)
    throw Error("Rockstar achievement response too large");
  return parseRockstarAwardedAchievements(JSON.parse(raw));
}
