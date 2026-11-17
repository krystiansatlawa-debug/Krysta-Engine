import type { UserPreferences } from "@types";

/** Screenshot and video recording are independent opt-in features.
 * Local achievement photos are disabled by default for privacy.
 */
export const isAchievementScreenshotEnabled = (
  preferences: Pick<UserPreferences,
    "screenshotOnAchievementEnabled" | "screenshotsEnabled"
  > | null | undefined
) => preferences?.screenshotOnAchievementEnabled === true &&
     preferences.screenshotsEnabled !== false;

/** Only the window matched to the unlocking game may be captured. */
export const isAchievementScreenshotTarget = (
  resolved: { status: string; target?: { gameKey: string } },
  expectedGameKey: string
) => resolved.status === "resolved" &&
     resolved.target?.gameKey === expectedGameKey;
