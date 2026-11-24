import { useEffect, useRef, useState } from "react";
import type { ScreenshotGamepadButton } from "@types";
import {
  createControllerShortcutRecorder,
  sampleControllerShortcuts,
} from "./controller-shortcut-recorder";
import { SCREENSHOT_GAMEPAD_COMBO_MAX_BUTTONS } from "./screenshot-input";

interface ShortcutCaptureBridge {
  beginControllerShortcutCapture: () => Promise<string | null>;
  endControllerShortcutCapture: (token: string) => Promise<void>;
}

export function useControllerShortcutRecorder(
  bridge: ShortcutCaptureBridge,
  disabled: boolean,
  onRecorded: (buttons: ScreenshotGamepadButton[]) => void | Promise<void>,
  pauseNavigation?: () => () => void
) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<"timeout" | "too_long" | "failed" | null>(
    null
  );
  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;
  const { beginControllerShortcutCapture, endControllerShortcutCapture } =
    bridge;

  useEffect(() => {
    if (!listening) return;
    if (disabled) {
      setListening(false);
      return;
    }

    let token: string | null = null;
    let frame = 0;
    let disposed = false;
    const stop = () => setListening(false);
    const read = () => sampleControllerShortcuts(navigator.getGamepads());
    const releaseNavigation = pauseNavigation?.();
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      stop();
    };
    const fail = () => {
      if (disposed) return;
      setError("failed");
      stop();
    };
    const timeout = window.setTimeout(() => {
      setError("timeout");
      stop();
    }, 10000);

    window.addEventListener("blur", stop);
    window.addEventListener("keydown", keydown, true);

    const begin = async () => {
      const record = createControllerShortcutRecorder(read());
      const captureToken = await beginControllerShortcutCapture();
      if (!captureToken) {
        fail();
        return;
      }
      if (disposed) {
        await endControllerShortcutCapture(captureToken);
        return;
      }
      token = captureToken;

      const poll = async () => {
        const buttons = record(read());
        if (!buttons) {
          frame = window.requestAnimationFrame(() => void poll().catch(fail));
          return;
        }
        window.clearTimeout(timeout);
        if (buttons.length > SCREENSHOT_GAMEPAD_COMBO_MAX_BUTTONS) {
          setError("too_long");
        } else {
          await onRecordedRef.current(buttons);
        }
        stop();
      };
      await poll();
    };
    void begin().catch(fail);

    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      window.cancelAnimationFrame(frame);
      window.removeEventListener("blur", stop);
      window.removeEventListener("keydown", keydown, true);
      releaseNavigation?.();
      if (token)
        void endControllerShortcutCapture(token).catch(() => undefined);
    };
  }, [
    beginControllerShortcutCapture,
    disabled,
    endControllerShortcutCapture,
    listening,
    pauseNavigation,
  ]);

  return {
    listening,
    error,
    start: () => {
      setError(null);
      setListening(true);
    },
    cancel: () => setListening(false),
  };
}
