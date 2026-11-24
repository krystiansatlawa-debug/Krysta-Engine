import type { UserPreferences } from "@types";

export const MAX_GAME_BOOST_APPLICATIONS = 20;

export const getGameBoostPreferences = (
  preferences?: UserPreferences | null
) => ({
  enabled: preferences?.gameBoostEnabled !== false,
  // Maximum performance is the only profile; legacy pause overrides are ignored.
  pauseBackgroundSync: true,
  closeApplications: Array.isArray(preferences?.gameBoostCloseApplications)
    ? preferences.gameBoostCloseApplications.filter(
        (application) => typeof application === "string"
      )
    : [],
  restoreApplications: preferences?.gameBoostRestoreApplications !== false,
});
