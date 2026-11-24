import type { UnlockedAchievement } from "@types";

export const mergeUnlockedAchievementLists = (
  remote: UnlockedAchievement[],
  local: UnlockedAchievement[]
): UnlockedAchievement[] => {
  const merged = new Map<string, UnlockedAchievement>();
  // Prefer the remote record, preserving independently confirmed hardcore data.
  for (const achievement of [...remote, ...local]) {
    const key = achievement.name?.trim().toUpperCase();
    if (!key) continue;
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, achievement);
      continue;
    }
    if (previous.hardcoreUnlockTime == null && achievement.hardcoreUnlockTime != null) {
      merged.set(key, { ...previous, hardcoreUnlockTime: achievement.hardcoreUnlockTime });
    }
  }
  const result = [...merged.values()];
  return result.length === remote.length && result.every((item, index) => item === remote[index]) ? remote : result;
};
