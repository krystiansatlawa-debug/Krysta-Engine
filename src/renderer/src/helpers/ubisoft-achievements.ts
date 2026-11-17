import type { UserAchievement } from "@types";

/**
 * Ubisoft's account-scoped achievements are displayed using Hydra's normal
 * achievement UI, but never written into Hydra/Steam/Epic unlock state.
 */
export interface UbisoftAchievementItem {
  id: string;
  title: string;
  description: string;
  icon: string | null;
  unlocked: boolean;
  completionDate: string | null;
}

export const isUbisoftLibraryGame = (shop: string, objectId: string) =>
  shop === "custom" &&
  /^(?:ubi-owned-[a-f0-9]{32}|ubisoft-\d+)$/.test(objectId);

const FALLBACK_ICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<rect width="64" height="64" rx="12" fill="#252525"/>' +
      '<path d="M20 13h24v10c0 11-6 18-12 18s-12-7-12-18V13ZM20 19H12v5c0 8 5 12 12 12M44 19h8v5c0 8-5 12-12 12M32 41v8m-11 4h22" fill="none" stroke="#ddd" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>' +
    "</svg>"
  );

export function toHydraUbisoftAchievements(
  items: readonly UbisoftAchievementItem[]
): UserAchievement[] {
  return items.map((achievement) => {
    const timestamp =
      achievement.unlocked && achievement.completionDate
        ? Date.parse(achievement.completionDate)
        : NaN;
    const icon = achievement.icon || FALLBACK_ICON;
    return {
      name: `ubisoft:${achievement.id}`,
      displayName: achievement.title,
      description: achievement.description,
      icon,
      icongray: icon,
      hidden: false,
      unlocked: achievement.unlocked,
      unlockTime: Number.isFinite(timestamp) ? timestamp : null,
      // Intentionally omit Steam/Epic source fields. These are Ubisoft
      // account achievements, not Hydra cloud or Steam unlocks.
    };
  });
}
