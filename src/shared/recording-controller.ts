import type { ScreenshotGamepadButton } from "@types";

const controllerLabels: Record<ScreenshotGamepadButton, string> = {
  a: "A",
  b: "B",
  x: "X",
  y: "Y",
  lb: "LB",
  rb: "RB",
  lt: "LT",
  rt: "RT",
  back: "View",
  start: "Menu",
  ls: "L3",
  rs: "R3",
  dpadUp: "D-pad ↑",
  dpadDown: "D-pad ↓",
  dpadLeft: "D-pad ←",
  dpadRight: "D-pad →",
};

export const recordingControllerLabel = (
  button: ScreenshotGamepadButton | ""
) => (button ? controllerLabels[button] : "");
