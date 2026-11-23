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

const unknownDisplayMode = {
  getDisplayMode: () => null,
  requestFullscreen: () => assert.fail("unexpected fullscreen shortcut"),
};

test("the first press minimizes the active game and the next restores that exact window", async () => {
  let active: TrackedGameWindow | null = game;
  const actions: Array<[string, TrackedGameWindow]> = [];
  const shortcut = new XboxGuideWindowToggle({
    ...unknownDisplayMode,
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
    ...unknownDisplayMode,
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
    ...unknownDisplayMode,
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
    ...unknownDisplayMode,
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
    ...unknownDisplayMode,
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
    before: "exclusive",
    after: ["fullscreen", "fullscreen"],
    expected: "fullscreen",
  },
  {
    before: "fullscreen",
    after: ["windowed", "windowed"],
    expected: "windowed",
  },
  { before: "exclusive", after: ["fullscreen", "exclusive"], expected: null },
  { before: "fullscreen", after: ["fullscreen"], expected: null },
  {
    before: "windowed",
    after: ["windowed", "windowed"],
    expected: "windowed",
  },
  { before: "windowed", after: ["fullscreen"], expected: null },
  { before: null, after: [null, "windowed", "windowed"], expected: "windowed" },
  { before: "exclusive", after: ["windowed", null], expected: null },
] satisfies {
  before: GameDisplayMode | null;
  after: (GameDisplayMode | null)[];
  expected: GameDisplayMode | null;
}[]) {
  test(`fullscreen recovery from ${scenario.before} through ${scenario.after.join(", ")}`, async () => {
    const observed = [scenario.before, ...scenario.after];
    const requests: { window: TrackedGameWindow; mode: GameDisplayMode }[] = [];
    const shortcut = new XboxGuideWindowToggle({
      findForegroundGame: async () => game,
      isTrackedGame: async () => true,
      minimize: () => true,
      restore: () => true,
      getDisplayMode: () => observed.shift() ?? null,
      requestFullscreen: (window, mode) => {
        requests.push({ window, mode });
        return true;
      },
    });
    await shortcut.sample(false);
    await shortcut.sample(true);
    await shortcut.sample(false);
    await shortcut.sample(true);
    assert.deepEqual(
      requests,
      scenario.expected ? [{ window: game, mode: scenario.expected }] : []
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
    getDisplayMode: () => "exclusive",
    requestFullscreen: () => assert.fail("stale fullscreen shortcut"),
  });
  await shortcut.sample(false);
  await shortcut.sample(true);
  await shortcut.sample(false);
  await shortcut.sample(true);
});
