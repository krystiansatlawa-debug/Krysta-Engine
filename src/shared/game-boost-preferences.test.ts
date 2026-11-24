import assert from "node:assert/strict";
import test from "node:test";
import { getGameBoostPreferences } from "./game-boost-preferences.js";

test("existing profiles get background sync deferral without closing apps", () => {
  assert.deepEqual(getGameBoostPreferences({}), {
    enabled: true,
    pauseBackgroundSync: true,
    closeApplications: [],
    minimizeAfterGame: false,
    restoreApplications: true,
  });
});

test("explicit Game Boost preferences are preserved", () => {
  const executable = String.raw`C:\Applications\example.exe`;

  assert.deepEqual(
    getGameBoostPreferences({
      gameBoostEnabled: false,
      gameBoostPauseBackgroundSync: false,
      gameBoostCloseApplications: [executable],
      gameBoostRestoreApplications: false,
      gameBoostMinimizeAfterGame: true,
    }),
    {
      enabled: false,
      pauseBackgroundSync: true,
      closeApplications: [executable],
      minimizeAfterGame: true,
      restoreApplications: false,
    }
  );
});
