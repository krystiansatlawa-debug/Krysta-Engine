import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScreenshotGamepadButton } from "@types";
import {
  createControllerShortcutRecorder,
  sampleControllerShortcuts,
} from "./controller-shortcut-recorder.js";

const pad = (index: number, ...buttons: ScreenshotGamepadButton[]) => ({
  index,
  buttons,
});

test("captures a chord from a single pad on release, ignoring held input at startup", () => {
  const record = createControllerShortcutRecorder([pad(0, "a")]);
  assert.equal(record([pad(0, "a")]), undefined);
  assert.equal(record([pad(0, "a", "b")]), undefined);
  assert.equal(record([pad(0)]), undefined);
  assert.equal(record([pad(0, "lb")]), undefined);
  assert.equal(record([pad(0, "lb", "rb"), pad(1, "y")]), undefined);
  assert.equal(record([pad(0, "rb"), pad(1, "y")]), undefined);
  assert.deepEqual(record([pad(0), pad(1, "y")]), ["lb", "rb"]);
});

test("captures a single button after a controller first becomes visible", () => {
  const record = createControllerShortcutRecorder([]);
  assert.equal(record([pad(0, "a")]), undefined);
  assert.deepEqual(record([pad(0)]), ["a"]);
});

test("does not commit a disconnected controller's partial chord", () => {
  const record = createControllerShortcutRecorder([]);
  assert.equal(record([pad(0, "a")]), undefined);
  assert.equal(record([pad(1, "lb")]), undefined);
  assert.equal(record([pad(1, "lb", "rb")]), undefined);
  assert.equal(record([pad(1)]), undefined);
  assert.equal(record([pad(1, "ls")]), undefined);
  assert.deepEqual(record([pad(1)]), ["ls"]);
});

test("maps standard buttons and trigger values while ignoring Guide", () => {
  const buttons = Array.from({ length: 17 }, (_, index) => ({
    pressed: index === 0 || index === 16,
    touched: false,
    value: index === 6 ? 0.8 : 0,
  }));
  const gamepad = {
    index: 2,
    mapping: "standard" as const,
    connected: true,
    buttons,
  };
  assert.deepEqual(sampleControllerShortcuts([gamepad]), [pad(2, "a", "lt")]);
  assert.deepEqual(
    sampleControllerShortcuts([{ ...gamepad, mapping: "" }]),
    []
  );
});
