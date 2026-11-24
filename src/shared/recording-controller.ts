import type { ScreenshotGamepadButton } from "@types";
import {
  normalizeScreenshotGamepadCombo,
  validateScreenshotGamepadCombo,
} from "./screenshot-input";

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
  buttons: readonly ScreenshotGamepadButton[]
) => buttons.map((button) => controllerLabels[button]).join(" + ");

export function normalizeRecordingControllerCombo(
  combo: unknown,
  legacyButton: unknown
): ScreenshotGamepadButton[] | null {
  const buttons =
    combo === undefined
      ? legacyButton === "" || legacyButton == null
        ? []
        : [legacyButton]
      : combo;

  if (
    !Array.isArray(buttons) ||
    !buttons.every((button) => typeof button === "string")
  ) {
    return null;
  }
  if (buttons.length === 0) return [];
  if (!validateScreenshotGamepadCombo(buttons).valid) return null;

  return normalizeScreenshotGamepadCombo(buttons);
}
