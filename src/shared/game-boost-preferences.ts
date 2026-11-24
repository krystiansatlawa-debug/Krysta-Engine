import type { UserPreferences } from "@types";

export const MAX_GAME_BOOST_APPLICATIONS = 20;

export const getGameBoostPreferences = (
  preferences?: UserPreferences | null
) => ({
  enabled: preferences?.gameBoostEnabled !== false,
  pauseBackgroundSync: preferences?.gameBoostPauseBackgroundSync !== false,
  closeApplications: Array.isArray(preferences?.gameBoostCloseApplications)
    ? preferences.gameBoostCloseApplications.filter(
        (application) => typeof application === "string"
      )
    : [],
  restoreApplications: preferences?.gameBoostRestoreApplications !== false,
});
