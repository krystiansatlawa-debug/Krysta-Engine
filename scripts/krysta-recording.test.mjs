import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { test } from "node:test";
import { setImmediate as flush } from "node:timers/promises";
import { runInNewContext } from "node:vm";

const source = readFileSync(
  new URL("../resources/krysta-recording.html", import.meta.url),
  "utf8"
).match(/<script>([\s\S]*?)<\/script>/)[1];

function fixture() {
  let clock = 0;
  let activeEncoders = 0;
  let previewCount = 0;
  let nextTimer = 0;
  const timers = new Map();
  const stops = [];
  const worker = {
    MediaRecorder: class {
      static isTypeSupported = () => true;
      state = "inactive";
      start() {
        assert.equal(activeEncoders, 0, "Previous encoder is still running");
        activeEncoders++;
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        // The recorder changes state immediately, but releases the encoder
        // asynchronously after the last dataavailable callback.
        stops.push(() => {
          activeEncoders--;
          this.ondataavailable({ data: new Blob(["clip"]) });
          this.onstop();
        });
      }
    },
    FileReader: class {
      readAsDataURL() {
        this.result = "data:video/webm;base64,Y2xpcA==";
        this.onload();
      }
    },
    Blob,
    document: {
      createElement(tag) {
        assert.equal(tag, "video");
        previewCount++;
        return {
          addEventListener: () => undefined,
          play: async () => {},
          pause: () => undefined,
        };
      },
    },
    navigator: {
      mediaDevices: {
        getDisplayMedia: async () => ({
          active: true,
          getAudioTracks: () => [],
          getTracks: () => [{ stop: () => undefined }],
          getVideoTracks: () => [{ addEventListener: () => undefined }],
        }),
      },
    },
    performance: { now: () => clock },
    setTimeout(fn, delay) {
      const id = ++nextTimer;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  runInNewContext(source, worker);
  return {
    start: (preSeconds) =>
      worker.krystaStart({
        preSeconds,
        seconds: 5,
        fps: 30,
        quality: 720,
        audio: false,
        maxBytes: 1000,
      }),
    save: () => worker.krystaSave(),
    manualStart: () => worker.krystaManualStart(),
    stopCapture: () => worker.krystaStop(),
    manualFinish: () => worker.krystaManualFinish(),
    previewCount: () => previewCount,
    activeEncoders: () => activeEncoders,
    acknowledgeStop() {
      assert.equal(stops.length, 1);
      stops.shift()();
    },
    advanceClock: (ms) => {
      clock += ms;
    },
    advance(delay) {
      const [id, timer] = [...timers].find(
        ([, entry]) => entry.delay === delay
      );
      timers.delete(id);
      clock += delay;
      timer.fn();
    },
  };
}

test("waits for the old encoder before recording when a buffer rotates", async () => {
  const f = fixture();
  await f.start(10);
  assert.equal(f.activeEncoders(), 1);
  assert.equal(f.previewCount(), 0);

  f.advance(10000);
  const save = f.save();
  await flush();
  assert.equal(f.activeEncoders(), 1);
  assert.equal(f.previewCount(), 0);

  f.acknowledgeStop();
  await flush();
  assert.equal(f.activeEncoders(), 1);
  assert.equal(f.previewCount(), 1);

  f.advance(5000);
  f.acknowledgeStop();
  const result = await save;
  assert.equal(result.before, 0);
  assert.equal(result.duration, 5);
  assert.equal(f.activeEncoders(), 1, "Buffer resumes after recording");
});

test("a clip with no replay buffer uses an encoder only after recording starts", async () => {
  const f = fixture();
  await f.start(0);
  assert.equal(f.activeEncoders(), 0);
  assert.equal(f.previewCount(), 0);

  const save = f.save();
  assert.equal(f.activeEncoders(), 1);
  f.advance(5000);
  f.acknowledgeStop();
  const result = await save;
  assert.equal(result.before, 0);
  assert.equal(result.data, "Y2xpcA==");
  assert.equal(f.activeEncoders(), 0);
});

test("keeps existing replay frames when saving between rotations", async () => {
  const f = fixture();
  await f.start(10);
  const recorders = f.activeEncoders();
  f.advanceClock(4000);

  const save = f.save();
  assert.equal(f.activeEncoders(), recorders);
  f.advance(5000);
  f.acknowledgeStop();
  const result = await save;
  assert.equal(result.before, 4);
  assert.equal(result.duration, 9);
});

test("manual start and stop records until the second hotkey without an achievement", async () => {
  const f = fixture();
  await f.start(0);
  await f.manualStart();
  assert.equal(f.activeEncoders(), 1);
  f.advanceClock(8000);
  const finishing = f.manualFinish();
  f.acknowledgeStop();
  const result = await finishing;
  assert.equal(result.before, 0);
  assert.equal(result.duration, 8);
  assert.equal(result.data, "Y2xpcA==");
  assert.equal(f.activeEncoders(), 0);
});

test("a stopped capture keeps its manual frames until the main process saves them", async () => {
  const f = fixture();
  await f.start(0);
  await f.manualStart();
  f.advanceClock(5000);
  f.stopCapture();
  f.acknowledgeStop();
  const result = await f.manualFinish();
  assert.equal(result.duration, 5);
  assert.equal(result.data, "Y2xpcA==");
});

function transpile(sourcePath) {
  return ts.transpileModule(
    readFileSync(new URL(sourcePath, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }
  ).outputText;
}

const recordingServiceSource = transpile(
  "../src/main/services/krysta-recordings.ts"
);
const screenshotInput = {};
const recordingController = {};
runInNewContext(transpile("../src/shared/screenshot-input.ts"), {
  exports: screenshotInput,
});
runInNewContext(transpile("../src/shared/recording-controller.ts"), {
  exports: recordingController,
});

async function serviceFixture(
  t,
  savedSettings,
  { shortcutAvailable = true, displayPermission = "media" } = {}
) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), "krysta-f9-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(directory, "recordings"));
  await fs.writeFile(
    path.join(directory, "recordings", "settings.json"),
    JSON.stringify({ enabled: true, ...savedSettings })
  );
  const hotkeys = new Map();
  const notices = [];
  const calls = [];
  let foreground = { windowHandle: "123", processId: 42 };
  let sourceList = [{ id: "window:123:0" }];
  const intervals = new Map();
  const controllerReads = [];
  const pressedButtons = new Set();
  let controllerConnected = true;
  let intervalId = 0;
  let permissionRequest;
  let displayMediaRequest;
  let workerContents;
  const captureSession = {
    setPermissionRequestHandler(handler) {
      permissionRequest = handler;
    },
    setPermissionCheckHandler() {},
    setDisplayMediaRequestHandler(handler) {
      displayMediaRequest = handler;
    },
  };
  const requestPermission = (contents, permission, details) =>
    new Promise((resolve) =>
      permissionRequest(contents, permission, resolve, details)
    );
  const deps = {
    electron: {
      app: {
        getPath: () => directory,
        isReady: () => true,
        whenReady: async () => {},
        on() {},
      },
      globalShortcut: {
        register: (key, callback) => {
          if (!shortcutAvailable) return false;
          hotkeys.set(key, callback);
          return true;
        },
        unregister: (key) => hotkeys.delete(key),
      },
      desktopCapturer: { getSources: async () => sourceList },
      session: { fromPartition: () => captureSession },
      BrowserWindow: class {
        destroyed = false;
        webContents = {
          mainFrame: {},
          executeJavaScript: async (script) => {
            calls.push(script);
            if (script.includes("krystaStart")) {
              const details = { isMainFrame: true, mediaTypes: [] };
              const allowed = await requestPermission(
                this.webContents,
                displayPermission,
                details
              );
              if (!allowed) throw Error("NotAllowedError: Permission denied");
              const streams = await new Promise((resolve) =>
                displayMediaRequest(
                  { frame: this.webContents.mainFrame, videoRequested: true },
                  resolve
                )
              );
              assert.equal(streams.video?.id, "window:123:0");
            }
            return script.includes("krystaManualFinish")
              ? { data: "GkXfow==", duration: 4, before: 0, audio: false }
              : true;
          },
          setWindowOpenHandler() {},
          on() {},
          once() {},
        };
        constructor() {
          workerContents = this.webContents;
        }
        isDestroyed = () => this.destroyed;
        destroy = () => {
          this.destroyed = true;
        };
        async loadFile() {}
      },
    },
    "node:path": path,
    "node:fs/promises": fs,
    "node:crypto": await import("node:crypto"),
    "@main/level": {},
    "@shared": { ...screenshotInput, ...recordingController },
    "./native-addon": {
      NativeAddon: {
        getWindowsGamepadButtonPressed(button) {
          controllerReads.push(button);
          return controllerConnected ? pressedButtons.has(button) : null;
        },
      },
    },
    "./game-running-state": {
      hasTrackedGamesRunning: () => true,
      onTrackedGamesRunningChange: () => () => undefined,
    },
    "./screenshots/foreground-game": {
      resolveForegroundGame: async () =>
        foreground
          ? {
              status: "resolved",
              game: { title: "Red Dead Redemption 2" },
              foreground,
              target: { gameKey: "steam:1174180" },
            }
          : { status: "unresolved" },
      resolveForegroundWindow: async () => foreground,
    },
    "./windows-game-window-match": {
      isWindowsWindowSource: (id, handle) => id === `window:${handle}:0`,
    },
    "@resources/krysta-recording.html?asset": "capture.html",
    "./recording-notice": {
      showRecordingNotice: (state) => notices.push(state),
    },
  };
  const exports = {};
  runInNewContext(recordingServiceSource, {
    exports,
    require(name) {
      assert.ok(Object.hasOwn(deps, name), name);
      return deps[name];
    },
    process: { platform: "win32" },
    setTimeout,
    clearTimeout,
    setInterval(callback, delay) {
      const handle = { id: ++intervalId, unref() {} };
      intervals.set(handle, { callback, delay });
      return handle;
    },
    clearInterval(handle) {
      intervals.delete(handle);
    },
    Buffer,
  });
  await exports.recordingState();
  await flush();
  return {
    ...exports,
    hotkeys,
    notices,
    calls,
    press() {
      assert.ok(hotkeys.has("F9"));
      hotkeys.get("F9")();
    },
    loseFocus() {
      foreground = null;
      for (const { callback, delay } of intervals.values()) {
        if (delay === 500) callback();
      }
    },
    restoreFocus: () => (foreground = { windowHandle: "123", processId: 42 }),
    controllerReads,
    sampleController(buttons, connected = true) {
      controllerConnected = connected;
      pressedButtons.clear();
      for (const button of buttons) pressedButtons.add(button);
      for (const { callback, delay } of intervals.values()) {
        if (delay === 24) callback();
      }
    },
    hideCaptureSource: () => (sourceList = []),
    workerPermission: (permission, details) =>
      requestPermission(workerContents, permission, details),
    otherWindowPermission: (permission, details) =>
      requestPermission({}, permission, details),
  };
}

async function waitFor(check) {
  const deadline = Date.now() + 1500;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, "Recording state did not update");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("F9 migrates the old default, starts capture, saves on focus loss and works again", async (t) => {
  const f = await serviceFixture(t, { hotkey: "Control+Shift+F9" });
  assert.deepEqual([...f.hotkeys.keys()], ["F9"]);
  f.press();
  await waitFor(() => f.notices.includes("started"));

  f.loseFocus();
  await waitFor(() => f.notices.includes("saved"));
  assert.equal((await f.recordingState()).clips.length, 1);
  assert.equal(f.calls.filter((call) => call.includes("krystaStop")).length, 0);

  f.restoreFocus();
  f.press();
  await waitFor(
    () => f.notices.filter((notice) => notice === "started").length === 2
  );
  f.press();
  await waitFor(
    () => f.notices.filter((notice) => notice === "saved").length === 2
  );
  assert.equal((await f.recordingState()).clips.length, 2);
});

test("retains an explicitly selected shortcut and reports when Windows rejects F9", async (t) => {
  const f = await serviceFixture(t, {
    hotkey: "Control+Shift+F9",
    hotkeyVersion: 1,
  });
  assert.deepEqual([...f.hotkeys.keys()], ["Control+Shift+F9"]);

  const occupied = await serviceFixture(t, {}, { shortcutAvailable: false });
  assert.equal((await occupied.recordingState()).shortcutError, true);
  assert.equal(occupied.hotkeys.size, 0);
});

test("F9 explains when the recognized game window cannot be captured", async (t) => {
  const f = await serviceFixture(t, {});
  f.hideCaptureSource();
  f.press();
  await waitFor(() => f.notices.includes("failed"));
  assert.match((await f.recordingState()).lastError, /trybu bez ramek/);
  assert.equal(f.calls.length, 0);
});

test("allows Electron 41 display capture but denies cameras, microphones and other frames", async (t) => {
  const f = await serviceFixture(t, {});
  await f.toggleManualRecording();
  assert.deepEqual(f.notices, ["started"]);
  assert.equal(
    await f.workerPermission("media", {
      isMainFrame: true,
      mediaTypes: ["video"],
    }),
    false
  );
  assert.equal(
    await f.workerPermission("media", {
      isMainFrame: true,
      mediaTypes: ["audio"],
    }),
    false
  );
  assert.equal(await f.workerPermission("media", { isMainFrame: true }), false);
  assert.equal(
    await f.workerPermission("media", { isMainFrame: false, mediaTypes: [] }),
    false
  );
  assert.equal(
    await f.otherWindowPermission("media", {
      isMainFrame: true,
      mediaTypes: [],
    }),
    false
  );
  await f.toggleManualRecording();
  assert.deepEqual(f.notices, ["started", "saved"]);
});

test("allows display-capture requests from newer Electron on the recorder main frame", async (t) => {
  const f = await serviceFixture(
    t,
    {},
    { displayPermission: "display-capture" }
  );
  await f.toggleManualRecording();
  assert.deepEqual(f.notices, ["started"]);
  await f.toggleManualRecording();
  assert.deepEqual(f.notices, ["started", "saved"]);
});

test("an assigned controller button starts recording once per press and saves on the next press", async (t) => {
  const f = await serviceFixture(t, { controllerButton: "back" });
  f.sampleController(["back"]);
  f.sampleController(["back"]);
  await flush();
  assert.deepEqual(f.notices, [], "A held button cannot start a recording");

  f.sampleController(["menu"]);
  assert.deepEqual(f.notices, [], "Unassigned buttons are ignored");
  f.sampleController(["back"]);
  await waitFor(() => f.notices.includes("started"));
  f.sampleController(["back"]);
  await flush();
  assert.deepEqual(f.notices, ["started"]);

  f.sampleController([], false);
  f.sampleController(["back"]);
  await flush();
  assert.deepEqual(
    f.notices,
    ["started"],
    "Reconnect with a held button does not stop"
  );

  f.sampleController([]);
  f.sampleController(["back"]);
  await waitFor(() => f.notices.includes("saved"));
  assert.equal((await f.recordingState()).clips.length, 1);
  assert.ok(f.hotkeys.has("F9"), "The keyboard shortcut is also registered");
});

test("controller input is opt-in and its supported binding can be saved or removed", async (t) => {
  const f = await serviceFixture(t, {});
  const settings = (await f.recordingState()).settings;
  assert.equal(settings.controllerButton, "");
  f.sampleController(["back"]);
  assert.deepEqual(f.controllerReads, []);

  await assert.rejects(
    f.setRecordingSettings({ ...settings, controllerButton: "guide" }),
    /Invalid recording settings/
  );
  await f.setRecordingSettings({ ...settings, controllerButton: "rb" });
  assert.equal((await f.recordingState()).settings.controllerButton, "rb");
  f.sampleController([]);
  assert.deepEqual(f.controllerReads, ["rb"]);

  await f.setRecordingSettings({ ...settings, controllerButton: "" });
  f.sampleController(["rb"]);
  assert.deepEqual(f.controllerReads, ["rb"]);
});

test("a controller press outside the foreground game stays quiet", async (t) => {
  const f = await serviceFixture(t, { controllerButton: "rb" });
  f.loseFocus();
  f.sampleController([]);
  f.sampleController(["rb"]);
  await flush();
  assert.deepEqual(f.notices, []);
  assert.equal((await f.recordingState()).recording, false);
});
