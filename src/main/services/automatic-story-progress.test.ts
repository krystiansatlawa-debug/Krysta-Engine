import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import vm from "node:vm";
import ts from "typescript";
import type { Game } from "@types";
import * as runningState from "./game-running-state.js";
import * as saveParser from "./story-progress-save.js";
import { levelKeys } from "../level/sublevels/keys.js";
import { getGameCatalogueIdentity } from "../../shared/library-catalogue.js";

const serviceSource = ts.transpileModule(
  readFileSync(
    new URL("./automatic-story-progress.ts", import.meta.url),
    "utf8"
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }
).outputText;

const game = (objectId: string): Game => ({
  shop: "steam",
  objectId,
  title: "Game without a known save format",
  remoteId: null,
  iconUrl: null,
  libraryHeroImageUrl: null,
  logoImageUrl: null,
  lastTimePlayed: null,
  playTimeInMilliseconds: 0,
  isDeleted: false,
});

test("captures unknown saves after a session and serializes scans across the library", async (t) => {
  const linked = {
    ...game("local-copy"),
    shop: "custom" as const,
    catalogueGame: { shop: "steam" as const, objectId: "10" },
  };
  const catalogue = game("10");
  const emulator = { ...game("20"), shop: "launchbox" as const };
  const portId = "20:sample-port";
  const activityKey = "steam:running";
  const scans: Array<{ objectId: string; signal: AbortSignal }> = [];
  const saved = new Map<string, unknown>();
  // Model LevelDB sublevels as independent namespaces. Sharing the same Map
  // makes a saved scan look like the configured save directory on refresh.
  const sublevelData = new Map<string, Map<string, unknown>>([
    ["automatic-story-progress", saved],
  ]);
  const exported = {} as typeof import("./automatic-story-progress.js");
  const deps: Record<string, unknown> = {
    electron: {},
    "node:path": {},
    "@main/level": {
      db: {
        sublevel: (name: string) => {
          const records = sublevelData.get(name) ?? new Map<string, unknown>();
          sublevelData.set(name, records);
          return {
            get: async (key: string) => records.get(key),
            put: async (key: string, record: unknown) => {
              records.set(key, record);
            },
            del: async (key: string) => {
              records.delete(key);
            },
          };
        },
      },
      levelKeys,
      gamesSublevel: {
        get: async (key: string) =>
          key === "custom:local-copy" ? linked : undefined,
      },
    },
    "../../shared/library-catalogue": { getGameCatalogueIdentity },
    "./game-running-state": runningState,
    "./story-progress-save": saveParser,
    "./hydra-story-save-discovery": {
      readHydraStorySave: async (
        target: Game,
        _source: unknown,
        _canContinue: unknown,
        signal: AbortSignal
      ): Promise<saveParser.StorySaveScan> => {
        scans.push({ objectId: target.objectId, signal });
        if (scans.length === 1) {
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true })
          );
        }
        return { automatic: null, status: "save-found", lastSaveAt: 123456 };
      },
    },
    "./story-progress-metadata.js": {
      discoverSelectedStorySaveFiles: async () => [],
    },
    "./logger": {
      logger: { error: assert.fail, debug: assert.fail },
    },
    "./steam": {},
    "./wine-prefix": {},
    "./window-manager": { WindowManager: { sendToAppWindows: () => {} } },
  };
  const subscriptions: Array<() => void> = [];
  deps["./game-running-state"] = {
    ...runningState,
    onTrackedGamesRunningChange: (listener: () => void) => {
      const unsubscribe = runningState.onTrackedGamesRunningChange(listener);
      subscriptions.push(unsubscribe);
      return unsubscribe;
    },
  };
  t.after(() => {
    for (const unsubscribe of subscriptions) unsubscribe();
    runningState.deleteEmulatorGameRunning(activityKey);
  });

  vm.runInNewContext(serviceSource, {
    exports: exported,
    require: (name: string) =>
      Object.hasOwn(deps, name) ? deps[name] : assert.fail(name),
    AbortController,
  });

  // No game card has been opened. The session close hooks schedule both games.
  runningState.setEmulatorGameRunning(activityKey);
  exported.queueAutomaticStoryProgress(linked);
  exported.queueAutomaticStoryProgress(emulator, portId);
  exported.refreshQueuedStoryProgress();
  await setImmediate();
  assert.equal(scans.length, 0);

  runningState.deleteEmulatorGameRunning(activityKey);
  exported.refreshQueuedStoryProgress();
  await setImmediate();
  exported.refreshQueuedStoryProgress();
  assert.deepEqual(
    scans.map(({ objectId }) => objectId),
    ["local-copy"]
  );

  runningState.setEmulatorGameRunning(activityKey);
  await setImmediate();
  assert.equal(scans[0]?.signal.aborted, true);
  assert.equal(saved.size, 0);

  runningState.deleteEmulatorGameRunning(activityKey);
  for (let i = 0; i < 2; i++) {
    exported.refreshQueuedStoryProgress();
    await setImmediate();
  }
  assert.deepEqual(
    scans.map(({ objectId }) => objectId),
    ["local-copy", portId, "local-copy"]
  );
  const view = await exported.getAutomaticStoryProgress(catalogue, false);
  assert.equal(view.automatic, null);
  assert.equal(view.automaticStatus, "save-found");
  assert.equal(view.lastSaveAt, 123456);
  assert.equal(
    (await exported.getAutomaticStoryProgress(emulator, false)).lastSaveAt,
    123456
  );

  // The queue may process another game's pending scan between calls.
  // Verify a fresh scan of each requested game, not the last global item.
  const countScans = (id: string) =>
    scans.filter(({ objectId }) => objectId === id).length;
  const expectNewScan = async (id: string, previousCount: number) => {
    for (let attempt = 0; attempt < 12 && countScans(id) <= previousCount; attempt++) {
      exported.refreshQueuedStoryProgress();
      await setImmediate();
    }
    assert.ok(countScans(id) > previousCount, `Expected a new scan for ${id}`);
  };

  // A refresh already running for the same catalogue game is reused by
  // getAutomaticStoryProgress rather than starting a duplicate disk scan.
  // Check that the in-flight refresh resolves with the saved result.
  const linkedResult = await exported.getAutomaticStoryProgress(catalogue, true);
  assert.equal(linkedResult.automaticStatus, "save-found");
  assert.equal(linkedResult.lastSaveAt, 123456);
  assert.ok(countScans(linked.objectId) >= 1);

  const priorEmulator = countScans(portId);
  await exported.getAutomaticStoryProgress(emulator, true);
  await expectNewScan(portId, priorEmulator);
});
