import assert from "node:assert/strict";
import test from "node:test";
import {
  XboxGuideWindowToggle,
  type GameDisplayMode,
  type TrackedGameWindow,
} from "./xbox-guide-window-toggle.js";

const game: TrackedGameWindow = {
  gameKey: "steam:1174180",
  handle: "352124",
  processId: 9012,
};

const alreadyFullscreen = {
  getDisplayMode: () => "fullscreen" as const,
  requestFullscreen: () => assert.fail("unexpected fullscreen shortcut"),
  fillScreen: () => assert.fail("unexpected fullscreen resize"),
};

test("the first press minimizes the active game and the next restores that exact window", async () => {
  let active: TrackedGameWindow | null = game;
  const actions: Array<[string, TrackedGameWindow]> = [];
  const shortcut = new XboxGuideWindowToggle({
    ...alreadyFullscreen,
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
  ]);
});

test("an already held button does not trigger when the listener starts", async () => {
  let minimized = 0;
  const shortcut = new XboxGuideWindowToggle({
    ...alreadyFullscreen,
    findForegroundGame: async () => game,
    isTrackedGame: async () => true,
    minimize: () => (++minimized, true),
    restore: () => assert.fail("unexpected restore"),
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
    ...alreadyFullscreen,
    findForegroundGame: async () => active,
    isTrackedGame: async () => false,
    minimize: () => true,
    restore: () => (++restoreCalls, true),
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
    ...alreadyFullscreen,
    findForegroundGame: () => result,
    isTrackedGame: async () => true,
    minimize: () => assert.fail("stale minimize"),
    restore: () => assert.fail("unexpected restore"),
  });

  await shortcut.sample(false);
  const processing = shortcut.sample(true);
  shortcut.reset();
  release(game);
  await processing;
});

test("a window that was not minimized is never stored for restoration", async () => {
  let minimizeCalls = 0;
  const shortcut = new XboxGuideWindowToggle({
    ...alreadyFullscreen,
    findForegroundGame: async () => game,
    isTrackedGame: async () => assert.fail("unexpected tracked game check"),
    minimize: () => (++minimizeCalls, false),
    restore: () => assert.fail("unexpected restore"),
  });

  for (let press = 0; press < 2; press++) {
    await shortcut.sample(false);
    await shortcut.sample(true);
  }
  assert.equal(minimizeCalls, 2);
});

for (const scenario of [
  {
    name: "waits for focus and lets the game enter fullscreen",
    after: [null, "windowed", "windowed", "exclusive"],
    expected: ["shortcut"],
  },
  {
    name: "fills the monitor when the game ignores the shortcut",
    after: Array<GameDisplayMode>(7).fill("windowed").concat("fullscreen"),
    expected: ["shortcut", "fill"],
  },
  {
    name: "fills the monitor immediately when the shortcut could not be sent",
    after: ["windowed", "windowed", "fullscreen"],
    shortcutBlocked: true,
    expected: ["shortcut", "fill"],
  },
  {
    name: "leaves a game that already fills the monitor alone",
    after: ["fullscreen"],
    expected: [],
  },
  {
    name: "leaves a game in exclusive fullscreen alone",
    after: ["exclusive"],
    expected: [],
  },
  {
    name: "does nothing when the game loses focus",
    after: ["windowed", null],
    expected: [],
  },
] satisfies {
  name: string;
  after: (GameDisplayMode | null)[];
  shortcutBlocked?: boolean;
  expected: string[];
}[]) {
  test(scenario.name, async () => {
    const observed = [...scenario.after];
    const actions: [string, TrackedGameWindow][] = [];
    const shortcut = new XboxGuideWindowToggle({
      findForegroundGame: async () => game,
      isTrackedGame: async () => true,
      minimize: () => true,
      restore: () => true,
      getDisplayMode: () => observed.shift() ?? null,
      requestFullscreen: (window) => {
        actions.push(["shortcut", window]);
        return !("shortcutBlocked" in scenario && scenario.shortcutBlocked);
      },
      fillScreen: (window) => {
        actions.push(["fill", window]);
      },
    });
    await shortcut.sample(false);
    await shortcut.sample(true);
    await shortcut.sample(false);
    await shortcut.sample(true);
    assert.deepEqual(
      actions,
      scenario.expected.map((action) => [action, game])
    );
  });
}

test("disabling the guide shortcut cancels a pending fullscreen request", async () => {
  const shortcut = new XboxGuideWindowToggle({
    findForegroundGame: async () => game,
    isTrackedGame: async () => true,
    minimize: () => true,
    restore: () => {
      shortcut.reset();
      return true;
    },
    getDisplayMode: () => assert.fail("stale display check"),
    requestFullscreen: () => assert.fail("stale fullscreen shortcut"),
    fillScreen: () => assert.fail("stale fullscreen resize"),
  });
  await shortcut.sample(false);
  await shortcut.sample(true);
  await shortcut.sample(false);
  await shortcut.sample(true);
});
