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
      // Ubisoft sometimes returns completionDate without a time zone.
      // Interpret these UTC-style timestamps consistently on every machine.
      const isoDate = achievement.completionDate?.trim() ?? "";
      const normalizedDate =
        /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?$/i.test(isoDate)
          ? isoDate + "Z"
          : isoDate;
      const unlockTime =
        achievement.unlocked && normalizedDate &&
        Number.isFinite(Date.parse(normalizedDate))
          ? Date.parse(normalizedDate)
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
