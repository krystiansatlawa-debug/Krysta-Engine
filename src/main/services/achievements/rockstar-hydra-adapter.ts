import type { UnlockedAchievement } from "@types";
import type { RockstarUnlockedAchievement } from "./rockstar-achievement-parser";

/**
 * Converts verified Rockstar unlocks into the same internal unlock format
 * used by Hydra's achievement system. Does not write Steam/Epic caches or
 * pretend Rockstar unlocks came from another platform.
 */
export function toHydraRockstarUnlocks(
  achievements: readonly RockstarUnlockedAchievement[]
): UnlockedAchievement[] {
  const unique = new Map<string, UnlockedAchievement>();
  for (const achievement of achievements) {
    if (!achievement.unlockedAt) continue;
    const milliseconds = Date.parse(achievement.unlockedAt);
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) continue;
    const key = achievement.id.toUpperCase();
    const unlock: UnlockedAchievement = {
      name: achievement.id,
      unlockTime: Math.floor(milliseconds / 1000),
    };
    const previous = unique.get(key);
    if (!previous || unlock.unlockTime < previous.unlockTime)
      unique.set(key, unlock);
  }
  return [...unique.values()];
}
