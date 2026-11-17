import type { SteamAchievement, UnlockedAchievement } from "@types";

/** Present confirmed local unlocks even if metadata is unavailable or omits an ID.
 * Never infer an unlock from catalogue data and never alter the sync payload.
 */
export const fillMissingAchievementDefinitions = (
  definitions: SteamAchievement[],
  unlocked: UnlockedAchievement[]
): SteamAchievement[] => {
  if (!unlocked.length) return definitions;

  const existing = new Set(definitions.map((entry) => entry.name.trim().toUpperCase()));
  const missing: SteamAchievement[] = [];

  for (const entry of unlocked) {
    const name = entry.name?.trim();
    if (!name || existing.has(name.toUpperCase())) continue;
    existing.add(name.toUpperCase());
    missing.push({
      name,
      displayName: name,
      description: "",
      icon: "",
      icongray: "",
      hidden: false,
    });
  }

  return missing.length ? [...definitions, ...missing] : definitions;
};
