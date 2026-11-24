import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";
import * as shared from "../../shared/controller-desktop.js";

async function fixture(enabled: boolean) {
  let stored: unknown = { enabled };
  let running = false;
  let buttons = 0;
  const listeners = new Set<() => void>();
  const timers = new Map<object, () => void>();
  const pointerEvents: string[] = [];
  const displayStates: boolean[] = [];
  const native = {
    polls: 0,
    stops: 0,
    pollDesktopControllers() {
      this.polls++;
      return [{ id: "xbox:0", axes: [0, 0, 0, 0], buttons }];
    },
    stopDesktopControllerInput() {
      this.stops++;
    },
    controllerDesktopAction(action: string) {
      pointerEvents.push(action);
      return true;
    },
  };
  const dependencies: Record<string, unknown> = {
    "@main/level": {
      db: {
        get: async () => stored,
        put: async (_key: string, next: unknown) => {
          stored = next;
        },
      },
      levelKeys: { desktopControllerSettings: "desktop-controller-settings" },
    },
    "@main/services/window-manager": { WindowManager: { appWindows: [] } },
    "../../shared/controller-desktop": shared,
    "./controller-display": {
      ControllerDisplay: {
        setModuleEnabled: (value: boolean) => displayStates.push(value),
      },
    },
    "./game-running-state": {
      hasTrackedGamesRunning: () => running,
      onTrackedGamesRunningChange: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    "./logger": { logger: { warn: (message: string) => assert.fail(message) } },
    "./native-addon": { NativeAddon: native },
  };
  const source = await fs.readFile(
    new URL("./desktop-controller.ts", import.meta.url),
    "utf8"
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const exported = {} as typeof import("./desktop-controller.js");
  new Function(
    "exports",
    "require",
    "process",
    "setTimeout",
    "clearTimeout",
    outputText
  )(
    exported,
    (key: string) => {
      assert.ok(Object.hasOwn(dependencies, key), `Missing fixture for ${key}`);
      return dependencies[key];
    },
    { platform: "win32" },
    (callback: () => void) => {
      const timer = { unref() {} };
      timers.set(timer, callback);
      return timer;
    },
    (timer: object) => timers.delete(timer)
  );
  return {
    controller: exported.DesktopController,
    timers,
    native,
    pointerEvents,
    displayStates,
    getStored: () => stored,
    gameRunning(value: boolean) {
      running = value;
      for (const listener of listeners) listener();
    },
    tick(nextButtons: number) {
      buttons = nextButtons;
      assert.equal(timers.size, 1);
      const [timer, callback] = [...timers.entries()][0];
      timers.delete(timer);
      callback();
    },
  };
}

test("starts without renderer windows and releases a drag across a game session", async () => {
  const runtime = await fixture(true);
  await runtime.controller.start();

  runtime.tick(0);
  runtime.tick(0);
  runtime.tick(1);
  assert.deepEqual(runtime.pointerEvents, ["leftDown"]);

  runtime.gameRunning(true);
  assert.equal(runtime.timers.size, 0);
  assert.deepEqual(runtime.pointerEvents, ["leftDown", "leftUp"]);

  runtime.gameRunning(false);
  runtime.tick(1);
  runtime.tick(1);
  assert.deepEqual(runtime.pointerEvents, ["leftDown", "leftUp"]);
  runtime.tick(0);
  runtime.tick(1);
  assert.deepEqual(runtime.pointerEvents, ["leftDown", "leftUp", "leftDown"]);

  runtime.controller.stop();
  assert.equal(runtime.timers.size, 0);
  assert.deepEqual(runtime.pointerEvents, [
    "leftDown",
    "leftUp",
    "leftDown",
    "leftUp",
  ]);
});

test("persists the module toggle and stops native input when disabled", async () => {
  const runtime = await fixture(false);
  await runtime.controller.start();
  assert.equal(runtime.timers.size, 0);
  assert.equal(runtime.native.polls, 0);

  await runtime.controller.updateSettings({ enabled: true });
  runtime.tick(0);
  assert.equal(runtime.native.polls, 1);
  const before = runtime.native.stops;

  await runtime.controller.updateSettings({ enabled: false });
  assert.equal(runtime.timers.size, 0);
  assert.ok(runtime.native.stops > before);
  assert.deepEqual(runtime.displayStates, [false, true, false]);
  assert.equal((runtime.getStored() as { enabled: boolean }).enabled, false);
});
