import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
