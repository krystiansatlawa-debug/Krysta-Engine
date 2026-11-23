import assert from "node:assert/strict";
import test from "node:test";
import {
  XboxGuideWindowToggle,
  type TrackedGameWindow,
} from "./xbox-guide-window-toggle.js";

const game: TrackedGameWindow = {
  gameKey: "steam:1174180",
  handle: "352124",
  processId: 9012,
};

test("the next press restores the same window and waits for it to go fullscreen", async () => {
  let active: TrackedGameWindow | null = game;
  const actions: Array<[string, TrackedGameWindow]> = [];
  let fullscreenCalls = 0;
  const shortcut = new XboxGuideWindowToggle({
    findForegroundGame: async () => active,
    isTrackedGame: async (key) => key === game.gameKey,
    minimize: (target) => {
      actions.push(["minimize", target]);
      active = null;
      return true;
    },
    restore: (target) => {
      actions.push(["restore", target]);
      return true;
    },
    fullscreen: (target) => {
      actions.push(["fullscreen", target]);
      return ++fullscreenCalls === 2;
    },
  });

  await shortcut.sample(false);
  await shortcut.sample(true);
  await shortcut.sample(true);
  assert.deepEqual(actions, [["minimize", game]]);
  await shortcut.sample(false);
  await shortcut.sample(true);
  assert.deepEqual(actions, [
    ["minimize", game],
    ["restore", game],
    ["fullscreen", game],
    ["fullscreen", game],
  ]);
});

test("an already held button does not trigger when the listener starts", async () => {
  let minimized = 0;
  const shortcut = new XboxGuideWindowToggle({
    findForegroundGame: async () => game,
    isTrackedGame: async () => true,
    minimize: () => (++minimized, true),
    restore: () => assert.fail("unexpected restore"),
    fullscreen: () => assert.fail("unexpected fullscreen"),
  });
  await shortcut.sample(true);
  await shortcut.sample(true);
  assert.equal(minimized, 0);
  await shortcut.sample(false);
  await shortcut.sample(true);
  assert.equal(minimized, 1);
});

test("a remembered window is discarded when its game closes", async () => {
  let active: TrackedGameWindow | null = game;
  let restoreCalls = 0;
  const shortcut = new XboxGuideWindowToggle({
    findForegroundGame: async () => active,
    isTrackedGame: async () => false,
    minimize: () => true,
    restore: () => (++restoreCalls, true),
    fullscreen: () => assert.fail("unexpected fullscreen"),
  });
  await shortcut.sample(false);
  await shortcut.sample(true);
  active = null;
  await shortcut.sample(false);
  await shortcut.sample(true);
  assert.equal(restoreCalls, 0);
});

test("a reset invalidates pending lookups before they can affect a window", async () => {
  let release!: (window: TrackedGameWindow) => void;
  const result = new Promise<TrackedGameWindow>((resolve) => {
    release = resolve;
  });
  const shortcut = new XboxGuideWindowToggle({
    findForegroundGame: () => result,
    isTrackedGame: async () => true,
    minimize: () => assert.fail("stale minimize"),
    restore: () => assert.fail("unexpected restore"),
    fullscreen: () => assert.fail("unexpected fullscreen"),
  });

  await shortcut.sample(false);
  const processing = shortcut.sample(true);
  shortcut.reset();
  release(game);
  await processing;
});

test("disabling the shortcut during restoration cancels fullscreen", async () => {
  const shortcut = new XboxGuideWindowToggle({
    findForegroundGame: async () => game,
    isTrackedGame: async () => true,
    minimize: () => true,
    restore: () => {
      shortcut.reset();
      return true;
    },
    fullscreen: () => assert.fail("stale fullscreen"),
  });
  await shortcut.sample(false);
  await shortcut.sample(true);
  await shortcut.sample(false);
  await shortcut.sample(true);
});

test("a window that was not minimized is never stored for restoration", async () => {
  let minimizeCalls = 0;
  const shortcut = new XboxGuideWindowToggle({
    findForegroundGame: async () => game,
    isTrackedGame: async () => assert.fail("unexpected tracked game check"),
    minimize: () => (++minimizeCalls, false),
    restore: () => assert.fail("unexpected restore"),
    fullscreen: () => assert.fail("unexpected fullscreen"),
  });

  for (let press = 0; press < 2; press++) {
    await shortcut.sample(false);
    await shortcut.sample(true);
  }
  assert.equal(minimizeCalls, 2);
});
