/**
 * Strict, read-only normalization of Rockstar Social Club achievement responses.
 * Never interpret progress-only entries as unlocked achievements.
 * Authentication and network access must be implemented separately.
 */
export interface RockstarUnlockedAchievement {
  id: string;
  unlockedAt: string | null;
}

export function parseRockstarUnlockedAchievements(payload: unknown): RockstarUnlockedAchievement[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("Invalid Rockstar achievement response");
  const entries = (payload as Record<string, unknown>).awardedAchievements;
  if (!entries || typeof entries !== "object" || Array.isArray(entries))
    throw new Error("Missing Rockstar achievement records");
  const unlocked: RockstarUnlockedAchievement[] = [];
  for (const [id, raw] of Object.entries(entries)) {
    if (!id || id.length > 256 || !raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error("Invalid Rockstar achievement entry");
    const row = raw as Record<string, unknown>;
    if (typeof row.achieved !== "boolean")
      throw new Error("Rockstar achievement unlock state missing");
    if (!row.achieved) continue;
    const timestamp = row.awardedAt ?? row.dateAchieved ?? row.unlockDate ?? null;
    const unlockedAt = typeof timestamp === "string" && Number.isFinite(Date.parse(timestamp))
      ? new Date(timestamp).toISOString()
      : null;
    unlocked.push({ id, unlockedAt });
  }
  return unlocked;
}
