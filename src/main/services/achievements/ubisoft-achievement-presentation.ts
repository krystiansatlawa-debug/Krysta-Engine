import type { UserAchievement } from "@types";

export interface UbisoftAchievementForView {
  id: string;
  title: string;
  description: string;
  icon: string | null;
  unlocked: boolean;
  completionDate: string | null;
}

/**
 * Read-only view of achievements returned by the Ubisoft account service.
 * In particular, this does NOT merge into Steam/Epic unlock caches, persist
 * a fabricated Steam achievement, or publish a new unlock notification.
 */
export function presentUbisoftAchievements(
  items: readonly UbisoftAchievementForView[]
): UserAchievement[] {
  return items
    .map((achievement): UserAchievement => {
      const unlockTime =
        achievement.unlocked &&
        achievement.completionDate &&
        Number.isFinite(Date.parse(achievement.completionDate))
          ? Date.parse(achievement.completionDate)
          : null;
      return {
        name: `ubisoft:${achievement.id}`,
        displayName: achievement.title,
        description: achievement.description,
        icon: achievement.icon ?? "",
        icongray: achievement.icon ?? "",
        hidden: false,
        unlocked: achievement.unlocked,
        unlockTime,
      };
    })
    .sort(
      (a, b) =>
        Number(b.unlocked) - Number(a.unlocked) ||
        (b.unlockTime ?? 0) - (a.unlockTime ?? 0) ||
        a.displayName.localeCompare(b.displayName)
    );
}
