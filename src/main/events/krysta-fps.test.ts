import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { PresentMonFps, adaptiveFpsInterval } from "../services/presentmon-fps.js";

const source = readFileSync(
  new URL("./krysta-fps.ts", import.meta.url),
  "utf8"
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
});

const game = { windowHandle: "game", processId: 42 };
const otherWindow = { windowHandle: "other", processId: 25 };
type PollTimer = { callback: () => void; delay: number; unref: () => void };
type Handler = (event: unknown, value?: unknown) => Promise<unknown>;

function fixture(preference: {
  enabled: boolean;
  output?: "window" | "rtss";
  hotkey?: string;
}) {
  const listeners = new Set<() => void>();
  const timers = new Set<PollTimer>();
  const intervals = new Set<() => void>();
  const handlers = new Map<string, Handler>();
  const registered = new Set<string>();
  const processes: number[] = [];
  const stopped: number[] = [];
  const rtss: number[] = [];
  let running = false;
  let foreground = game;

  const app = Object.assign(new EventEmitter(), {
    isReady: () => true,
    whenReady: async () => {},
    getPath: () => "mock-user-data",
    getAppPath: () => "mock-app",
  });

  class Overlay {
    destroyed = false;
    visible = false;
    setIgnoreMouseEvents(ignore: boolean) {
      assert.equal(ignore, true);
    }
    setAlwaysOnTop(enabled: boolean) {
      assert.equal(enabled, true);
    }
    loadURL() {
      return Promise.resolve();
    }
    showInactive() {
      this.visible = true;
    }
    hide() {
      this.visible = false;
    }
    destroy() {
      this.hide();
      this.destroyed = true;
    }
    isDestroyed() {
      return this.destroyed;
    }
  }

  const dependencies: Record<string, unknown> = {
    electron: {
      app,
      BrowserWindow: Overlay,
      ipcMain: {
        handle: (key: string, handler: Handler) => handlers.set(key, handler),
      },
      screen: Object.assign(new EventEmitter(), {
        screenToDipRect: (_window: unknown, bounds: unknown) => bounds,
        getDisplayMatching: () => ({
          bounds: { x: 0, y: 0, width: 800, height: 600 },
        }),
      }),
      globalShortcut: {
        register: (key: string) => (registered.add(key), true),
        unregister: (key: string) => registered.delete(key),
      },
    },
    "node:fs": { promises: { stat: async () => ({ isFile: () => true }) } },
    "node:path": path,
    "node:child_process": {
      spawn: (_tool: string, args: string[]) => {
        const processId = Number(args[1]);
        processes.push(processId);
        return Object.assign(new EventEmitter(), {
          kill: () => stopped.push(processId),
        });
      },
    },
    "node:readline": { createInterface: () => new EventEmitter() },
    "@main/services/krysta-settings-recovery": {
      readKrystaSettings: async () => preference,
    },
    "@main/services/screenshots/foreground-game": {
      resolveForegroundGame: async () =>
        foreground === game
          ? { status: "resolved", target: { gameKey: "game-key" }, foreground }
          : { status: "unresolved" },
    },
    "@main/services/game-running-state": {
      hasTrackedGamesRunning: () => running,
      isTrackedGameKeyRunning: () => running,
      onTrackedGamesRunningChange: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    "@main/services/native-addon": {
      NativeAddon: {
        getWindowsForegroundWindow: () => foreground,
        getWindowsWindowBounds: () => ({
          client: { left: 0, top: 0, right: 800, bottom: 600 },
        }),
        isRtssOsdAvailable: () => true,
        updateRtssOsd: (pid: number) => (rtss.push(pid), true),
      },
    },
    "@main/services/presentmon-fps": { PresentMonFps, adaptiveFpsInterval },
  };

  runInNewContext(outputText, {
    exports: {},
    process: { platform: "win32", resourcesPath: "mock-resources" },
    require: (name: string) => dependencies[name],
    setTimeout: (callback: () => void, delay: number) => {
      const timer = { callback, delay, unref: () => {} };
      timers.add(timer);
      return timer;
    },
    clearTimeout: (timer: PollTimer) => timers.delete(timer),
    setInterval: (callback: () => void) => (intervals.add(callback), callback),
    clearInterval: (callback: () => void) => intervals.delete(callback),
  });

  return {
    processes,
    stopped,
    timers,
    intervals,
    rtss,
    registered,
    async setRunning(value: boolean) {
      running = value;
      for (const listener of listeners) listener();
      await setImmediate();
    },
    async focus(window: typeof game) {
      foreground = window;
      const timer = [...timers].at(-1);
      assert.ok(timer);
      timers.delete(timer);
      timer.callback();
      await setImmediate();
    },
    invoke: (channel: string, value?: unknown) =>
      handlers.get(channel)!(null, value),
  };
}

test("FPS only polls during tracked games and stops PresentMon when focus leaves", async () => {
  const fps = fixture({ enabled: true });
  await setImmediate();
  assert.equal(fps.timers.size, 0);
  await fps.setRunning(true);
  assert.deepEqual(fps.processes, [42]);
  assert.equal(fps.timers.size, 2);
  assert.equal(fps.intervals.size, 0);

  await fps.focus(otherWindow);
  assert.deepEqual(fps.stopped, [42]);
  assert.equal(fps.intervals.size, 0);
  await fps.focus(game);
  assert.deepEqual(fps.processes, [42, 42]);

  await fps.setRunning(false);
  assert.deepEqual(fps.stopped, [42, 42]);
  assert.equal(fps.timers.size, 0);
  assert.equal(fps.intervals.size, 0);
});

test("the RTSS output stops publishing when focus leaves the tracked game", async () => {
  const fps = fixture({ enabled: true, output: "rtss" });
  await setImmediate();
  await fps.setRunning(true);
  assert.deepEqual(fps.rtss, [42]);
  await fps.focus(otherWindow);
  assert.deepEqual(fps.rtss, [42, 0]);
  assert.equal(
    ((await fps.invoke("krysta:fps-status")) as { rtssReceiving: boolean })
      .rtssReceiving,
    false
  );
  assert.deepEqual(fps.processes, []);
});

test("FPS preserves the F9 recording shortcut when reading older preferences", async () => {
  const fps = fixture({ enabled: true, hotkey: "F9" });
  await setImmediate();
  assert.deepEqual([...fps.registered], ["Control+Shift+F10"]);
  assert.equal(await fps.invoke("krysta:fps-hotkey"), "Control+Shift+F10");
  await assert.rejects(
    fps.invoke("krysta:fps-set-hotkey", "F9"),
    /reserved for recording/
  );
});
