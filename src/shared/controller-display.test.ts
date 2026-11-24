import assert from "node:assert/strict";
import test from "node:test";
import {
  readControllerDisplaySettings,
  resolveControllerTelevision,
  type ControllerDisplay,
} from "./controller-display.js";

const monitor: ControllerDisplay = {
  id: "monitor",
  label: "Screen",
  active: true,
  hdmi: false,
  internal: true,
};
const television: ControllerDisplay = {
  id: "television",
  label: "Screen",
  active: false,
  hdmi: true,
  internal: false,
};

test("uses the preferred hardware ID across displays with the same label", () => {
  assert.equal(
    resolveControllerTelevision([monitor, television], "television"),
    television
  );
  assert.equal(resolveControllerTelevision([monitor], "television"), undefined);
});

test("selects HDMI only when the automatic target can be determined", () => {
  assert.equal(
    resolveControllerTelevision([monitor, television], null),
    television
  );
  const secondTv = { ...television, id: "second" };
  assert.equal(
    resolveControllerTelevision([television, secondTv], null),
    undefined
  );
  assert.equal(
    resolveControllerTelevision(
      [{ ...television, active: true }, secondTv],
      null
    ),
    undefined
  );
});

test("accepts independent preference changes without resetting other choices", () => {
  assert.deepEqual(
    readControllerDisplaySettings({
      preferredDisplayId: 123,
      autoSwitchToTv: true,
      switchHdmiAudio: "true",
    }),
    { autoSwitchToTv: true }
  );
  assert.deepEqual(
    readControllerDisplaySettings({ preferredDisplayId: null }),
    { preferredDisplayId: null }
  );
});
