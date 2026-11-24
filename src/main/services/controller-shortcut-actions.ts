import type { ScreenshotGamepadButton } from "@types";
import { isSameScreenshotGamepadCombo } from "@shared";
import { NativeAddon } from "./native-addon";
import { isControllerShortcutCaptureActive } from "./controller-shortcut-capture";

type ShortcutAction = "screenshot" | "recording";
type Trigger = () => boolean;

const bindings: Record<ShortcutAction, readonly ScreenshotGamepadButton[]> = {
  screenshot: [],
  recording: [],
};
let overlap:
  | { preferred: ShortcutAction; buttons: readonly ScreenshotGamepadButton[] }
  | undefined;
let hold:
  | {
      timer: ReturnType<typeof setInterval>;
      deferred?: Trigger;
      handled: boolean;
    }
  | undefined;

function clearHold() {
  if (hold) clearInterval(hold.timer);
  hold = undefined;
}

export function setControllerShortcutBinding(
  action: ShortcutAction,
  buttons: readonly ScreenshotGamepadButton[]
) {
  if (isSameScreenshotGamepadCombo(bindings[action], buttons)) return;
  bindings[action] = buttons;
  clearHold();
  overlap = undefined;

  const { screenshot, recording } = bindings;
  if (!screenshot.length || !recording.length) return;
  if (recording.every((button) => screenshot.includes(button))) {
    overlap = { preferred: "screenshot", buttons: recording };
  } else if (screenshot.every((button) => recording.includes(button))) {
    overlap = { preferred: "recording", buttons: screenshot };
  }
}

export function dispatchControllerShortcut(
  action: ShortcutAction,
  trigger: Trigger
) {
  if (isControllerShortcutCaptureActive()) return false;
  if (!overlap) return trigger();

  if (!hold) {
    const { buttons } = overlap;
    const timer = setInterval(() => {
      const pressed = NativeAddon.getWindowsGamepadComboPressed(buttons);
      if (pressed === true) return;
      const deferred = hold?.deferred;
      clearHold();
      if (pressed === false && !isControllerShortcutCaptureActive())
        deferred?.();
    }, 24);
    timer.unref();
    hold = { timer, handled: false };
  }

  if (action === overlap.preferred) {
    hold.handled = true;
    hold.deferred = undefined;
    return trigger();
  }

  // Wait for the shared buttons to release before committing the shorter shortcut.
  // Completing the longer shortcut during this hold supersedes the shorter one.
  if (!hold.handled) hold.deferred = trigger;
  return !hold.handled;
}
