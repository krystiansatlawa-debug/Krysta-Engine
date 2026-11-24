import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { setImmediate } from "node:timers/promises";
import {
  isGameBoostBackgroundSyncPaused,
  onGameBoostBackgroundSyncChange,
  syncGameBoostBackgroundSyncPreferences,
  waitForGameBoostBackgroundSync,
} from "./game-boost-background-sync.js";
import {
  clearGamesPlaytimeState,
  deleteEmulatorGameRunning,
  deleteRecompilationGameRunning,
  setEmulatorGameRunning,
  setGamePlaytime,
  setRecompilationGameRunning,
} from "./game-running-state.js";

const emulator = "launchbox:1";
const port = "launchbox:2:port";

afterEach(() => {
  clearGamesPlaytimeState();
  deleteEmulatorGameRunning(emulator);
  deleteRecompilationGameRunning(port);
  syncGameBoostBackgroundSyncPreferences(null);
});

test("background work resumes only after all tracked session types exit", async () => {
  setGamePlaytime("steam:1", {
    firstTick: 0,
    lastTick: 0,
    lastSyncTick: 0,
    countHydraPlaytime: true,
  });
  setEmulatorGameRunning(emulator);
  setRecompilationGameRunning(port, "launchbox:2", "port");
  let resumed = false;
  const pending = waitForGameBoostBackgroundSync().then(() => {
    resumed = true;
  });
  assert.equal(isGameBoostBackgroundSyncPaused(), true);

  clearGamesPlaytimeState();
  deleteEmulatorGameRunning(emulator);
  await setImmediate();
  assert.equal(resumed, false);

  deleteRecompilationGameRunning(port);
  await pending;
  assert.equal(resumed, true);
  assert.equal(isGameBoostBackgroundSyncPaused(), false);
});

test("changing the pause preference releases waiting tasks during gameplay", async () => {
  setEmulatorGameRunning(emulator);
  const pending = waitForGameBoostBackgroundSync();
  syncGameBoostBackgroundSyncPreferences({
    gameBoostPauseBackgroundSync: false,
  });
  await pending;
  assert.equal(isGameBoostBackgroundSyncPaused(), false);
  syncGameBoostBackgroundSyncPreferences({ gameBoostEnabled: false });
  assert.equal(isGameBoostBackgroundSyncPaused(), false);
});

test("deferred synchronization can be cancelled when its game restarts", async () => {
  setEmulatorGameRunning(emulator);
  const controller = new AbortController();
  const pending = waitForGameBoostBackgroundSync(controller.signal);
  controller.abort(new Error("game restarted"));
  await assert.rejects(pending, /game restarted/);
  assert.equal(isGameBoostBackgroundSyncPaused(), true);
});

test("a failing listener cannot block deferred tasks from resuming", async () => {
  setEmulatorGameRunning(emulator);
  const unsubscribe = onGameBoostBackgroundSyncChange(() => {
    throw new Error("test listener failure");
  });
  try {
    const pending = waitForGameBoostBackgroundSync();
    deleteEmulatorGameRunning(emulator);
    await pending;
    assert.equal(isGameBoostBackgroundSyncPaused(), false);
  } finally {
    unsubscribe();
  }
});
