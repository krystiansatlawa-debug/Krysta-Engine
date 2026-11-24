import type { UserAchievement } from "@types";

export type RockstarAward = {
  id: string;
  unlockTime: number | null;
};

/**
 * Interpret the response from the authenticated Rockstar awardedAchievements
 * endpoint. It can include partial progress with achieved: false.
 * Never represent progress-only records as unlocked.
 *
 * No credentials or cookies are accepted or retained by this parser.
 */
export function parseRockstarAwardedAchievements(
  value: unknown
): RockstarAward[] {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid Rockstar achievements response");

  const payload = (value as Record<string, unknown>).awardedAchievements;
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw Error("Rockstar achievement data missing");

  const entries = Object.entries(payload);
  if (entries.length > 2000)
    throw Error("Rockstar achievement data exceeds safe limit");

  const result: RockstarAward[] = [];
  for (const [id, raw] of entries) {
    if (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(id)) continue;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const award = raw as Record<string, unknown>;
    if (award.achieved !== undefined && award.achieved !== true && award.achieved !== 1 && award.achieved !== "1" && award.achieved !== "true") continue;
    // In older responses the achieved flag was omitted. A valid
    // dateAchieved is required as evidence of a genuine unlock.
    const date = award.dateAchieved;
    if (typeof date !== "string" || !date.trim()) continue;
    const time = Date.parse(date);
    if (!Number.isFinite(time) || time <= 0 || time > Date.now() + 86400000) continue;
    result.push({ id, unlockTime: time });
  }
  return result.sort((a, b) => (b.unlockTime ?? 0) - (a.unlockTime ?? 0));
}

export type RockstarAchievementDefinition = {
  id: string;
  title: string;
  description?: string;
  icon?: string | null;
};

/**
 * Keep Rockstar achievements separate from Steam and Epic. Rockstar numeric
 * unlock IDs are never silently matched to Steam API achievement names.
 */
export function presentRockstarAwards(
  definitions: readonly RockstarAchievementDefinition[],
  awards: readonly RockstarAward[]
): UserAchievement[] {
  const unlocked = new Map(awards.map((award) => [award.id, award]));
  return definitions.map((definition) => {
    const award = unlocked.get(definition.id);
    return {
      name: `rockstar:${definition.id}`,
      displayName: definition.title,
      description: definition.description ?? "",
      icon: definition.icon ?? "",
      icongray: definition.icon ?? "",
      hidden: false,
      unlocked: !!award,
      unlockTime: award?.unlockTime ?? null,
    };
  }).sort(
    (a, b) =>
      Number(b.unlocked) - Number(a.unlocked) ||
      (b.unlockTime ?? 0) - (a.unlockTime ?? 0) ||
      a.displayName.localeCompare(b.displayName)
  );
}
