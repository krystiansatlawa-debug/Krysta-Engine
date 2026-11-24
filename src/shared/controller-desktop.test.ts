import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultWindowsControllerProfile,
  defaultWindowsDesktopControllerSettings,
  DesktopControllerSession,
  getControllerBinding,
  setControllerBinding,
  updateWindowsDesktopControllerSettings,
  type DesktopPadFrame,
} from "./controller-desktop.js";

const pad = (pressed: number[] = [], axes = [0, 0, 0, 0]): DesktopPadFrame => ({
  axes,
  buttons: Array.from({ length: 19 }, (_, index) => pressed.includes(index)),
});

test("releases a drag using the previous binding on a profile change", () => {
  const session = new DesktopControllerSession();
  const profile = setControllerBinding(
    defaultWindowsControllerProfile(),
    "left",
    2
  );
  const next = setControllerBinding(profile, "left", 0);
  assert.deepEqual(session.update("xbox:0", pad(), profile, false), []);
  assert.deepEqual(session.update("xbox:0", pad([2]), profile, false), [
    { type: "mouse", button: "left", down: true },
  ]);
  assert.deepEqual(session.update("xbox:0", pad([2]), next, false), [
    { type: "mouse", button: "left", down: false },
  ]);
  assert.deepEqual(session.update("xbox:0", pad([0]), next, false), []);
  session.update("xbox:0", pad(), next, false);
  assert.deepEqual(session.update("xbox:0", pad([0]), next, false), [
    { type: "mouse", button: "left", down: true },
  ]);
  assert.deepEqual(session.reset(), [
    { type: "mouse", button: "left", down: false },
  ]);
});

test("game start and disconnect release the mouse and require neutral input on resume", () => {
  const session = new DesktopControllerSession();
  const profile = defaultWindowsControllerProfile();
  session.update("xbox:0", pad(), profile, false);
  assert.deepEqual(session.update("xbox:0", pad([1]), profile, false), [
    { type: "mouse", button: "right", down: true },
  ]);
  assert.deepEqual(session.update("xbox:0", pad([1]), profile, true), [
    { type: "mouse", button: "right", down: false },
  ]);
  assert.deepEqual(session.update("xbox:0", pad([1]), profile, false), []);
  assert.deepEqual(
    session.update("xbox:0", pad([], [0.6, 0, 0, 0]), profile, false),
    []
  );
  session.update("xbox:0", pad(), profile, false);
  assert.deepEqual(session.update("xbox:0", pad([0]), profile, false), [
    { type: "mouse", button: "left", down: true },
  ]);
  assert.deepEqual(session.update(null, null, profile, false), [
    { type: "mouse", button: "left", down: false },
  ]);
});

test("preserves a drag during pointer movement and only triggers shortcuts on press", () => {
  const session = new DesktopControllerSession();
  const profile = setControllerBinding(
    defaultWindowsControllerProfile(),
    "nextDisplay",
    9
  );
  session.update("xbox:0", pad(), profile, false);
  const active = pad([0, 8, 9, 14, 15, 11], [1, -1, 1, -1]);
  assert.deepEqual(session.update("xbox:0", active, profile, false), [
    { type: "mouse", button: "left", down: true },
    { type: "move", x: 12, y: -12 },
    { type: "scroll", x: 1, y: -1 },
    { type: "keyboard" },
    { type: "copy" },
    { type: "paste" },
    { type: "selectAll" },
    { type: "nextDisplay" },
  ]);
  assert.deepEqual(session.update("xbox:0", active, profile, false), [
    { type: "move", x: 12, y: -12 },
    { type: "scroll", x: 1, y: -1 },
  ]);
});

test("per-device patches preserve other profiles and resolve invalid and conflicting bindings", () => {
  const first = updateWindowsDesktopControllerSettings(
    defaultWindowsDesktopControllerSettings(),
    {
      enabled: true,
      autoShowKeyboard: true,
      preferredDeviceId: "xbox:0",
      profiles: {
        "xbox:0": { cursorSpeed: 100, bindings: { left: 8, invalid: 42 } },
        "not-a-device": { enabled: true },
      },
    }
  );
  assert.equal(first.profiles["xbox:0"].cursorSpeed, 40);
  assert.equal(getControllerBinding(first.profiles["xbox:0"], "keyboard"), -1);
  assert.deepEqual(Object.keys(first.profiles), ["xbox:0"]);
  const second = updateWindowsDesktopControllerSettings(first, {
    preferredDeviceId: "not-a-device",
    profiles: { "xbox:1": { enabled: false } },
  });
  assert.equal(second.enabled, true);
  assert.equal(second.autoShowKeyboard, true);
  assert.equal(second.preferredDeviceId, "xbox:0");
  assert.equal(second.profiles["xbox:0"], first.profiles["xbox:0"]);
  assert.equal(second.profiles["xbox:1"].enabled, false);
});
