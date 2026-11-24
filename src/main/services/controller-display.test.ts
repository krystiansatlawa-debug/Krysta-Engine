import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";
import * as shared from "../../shared/controller-display.js";

async function fixture() {
  const monitor: shared.ControllerDisplay = {
    id: "monitor",
    label: "Monitor",
    active: true,
    hdmi: false,
    internal: true,
  };
  const television: shared.ControllerDisplay = {
    id: "tv",
    label: "TV",
    active: false,
    hdmi: true,
    internal: false,
  };
  let displays = [monitor, television];
  let runningGames = 0;
  const listeners = new Set<() => void>();
  const operations: string[] = [];
  const audioDefaults = ["console", "multimedia", "communications"];
  const dependencies: Record<string, unknown> = {
    "@main/level": {
      db: {
        get: async () => ({
          preferredDisplayId: television.id,
          autoSwitchToTv: true,
          restoreDisplayAfterGame: true,
          switchHdmiAudio: true,
        }),
      },
      levelKeys: { controllerDisplaySettings: "controller-display-settings" },
    },
    "../../shared/controller-display": shared,
    "./game-running-state": {
      hasTrackedGamesRunning: () => runningGames > 0,
      onTrackedGamesRunningChange: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    "./logger": { logger: { warn: (message: string) => assert.fail(message) } },
    "./native-addon": {
      NativeAddon: {
        getWindowsControllerDisplays: () => displays,
        getWindowsControllerAudioDefaults: () => audioDefaults,
        switchWindowsControllerDisplay: (
          mode: string,
          id: string,
          temporary: boolean
        ) => {
          assert.deepEqual(
            [mode, id, temporary],
            ["display", television.id, true]
          );
          operations.push("project to TV");
          return true;
        },
        restoreWindowsControllerDisplay: () => {
          operations.push("restore monitor");
          return true;
        },
        switchWindowsControllerHdmiAudio: (
          label: string,
          singleDisplay: boolean
        ) => {
          assert.deepEqual([label, singleDisplay], [television.label, true]);
          operations.push("select HDMI audio");
          return true;
        },
        restoreWindowsControllerAudioDefaults: (previous: string[]) => {
          assert.deepEqual(previous, audioDefaults);
          operations.push("restore audio");
          return true;
        },
      },
    },
  };
  const source = await fs.readFile(
    new URL("./controller-display.ts", import.meta.url),
    "utf8"
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const exported = {} as typeof import("./controller-display.js");
  new Function("exports", "require", "process", outputText)(
    exported,
    (key: string) => {
      assert.ok(Object.hasOwn(dependencies, key), `Missing fixture for ${key}`);
      return dependencies[key];
    },
    { platform: "win32" }
  );
  return {
    controller: exported.ControllerDisplay,
    operations,
    listeners,
    setRunningGames(count: number) {
      runningGames = count;
      for (const listener of listeners) listener();
    },
    unplugTelevision() {
      displays = [monitor];
      exported.ControllerDisplay.handleTopologyChanged();
    },
  };
}

test("projects to TV only after enabling and restores display and audio after the last game", async () => {
  const runtime = await fixture();
  await runtime.controller.openBigPicture();
  assert.deepEqual(runtime.operations, []);

  runtime.controller.setModuleEnabled(true);
  assert.deepEqual(runtime.operations, ["project to TV", "select HDMI audio"]);

  runtime.setRunningGames(1);
  runtime.setRunningGames(2);
  runtime.setRunningGames(1);
  assert.deepEqual(runtime.operations, ["project to TV", "select HDMI audio"]);

  runtime.setRunningGames(0);
  assert.deepEqual(runtime.operations, [
    "project to TV",
    "select HDMI audio",
    "restore monitor",
    "restore audio",
  ]);
});

test("recovers from unplugging the TV during a game and detaches when disabled", async () => {
  const runtime = await fixture();
  runtime.controller.setModuleEnabled(true);
  await runtime.controller.openBigPicture();
  runtime.setRunningGames(1);
  runtime.unplugTelevision();
  runtime.setRunningGames(0);

  assert.deepEqual(runtime.operations, [
    "project to TV",
    "select HDMI audio",
    "restore monitor",
    "restore audio",
  ]);
  runtime.controller.setModuleEnabled(false);
  assert.equal(runtime.listeners.size, 0);
});
