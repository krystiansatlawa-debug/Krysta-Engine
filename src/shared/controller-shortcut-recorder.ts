import type { ScreenshotGamepadButton } from "@types";
import { SCREENSHOT_GAMEPAD_BUTTONS } from "./screenshot-input.js";

interface ControllerSample {
  index: number;
  buttons: ScreenshotGamepadButton[];
}

export function sampleControllerShortcuts(
  gamepads: readonly (Pick<
    Gamepad,
    "connected" | "mapping" | "index" | "buttons"
  > | null)[]
): ControllerSample[] {
  return gamepads.flatMap((gamepad) => {
    if (!gamepad?.connected || gamepad.mapping !== "standard") return [];

    return [
      {
        index: gamepad.index,
        // The shortcut names follow the standard Gamepad API button order.
        buttons: SCREENSHOT_GAMEPAD_BUTTONS.filter((_, index) => {
          const button = gamepad.buttons[index];
          return button?.pressed || (button?.value ?? 0) >= 0.5;
        }),
      },
    ];
  });
}

export function createControllerShortcutRecorder(initial: ControllerSample[]) {
  const waitForRelease = new Set(
    initial
      .filter((sample) => sample.buttons.length > 0)
      .map(({ index }) => index)
  );
  let active: ControllerSample | undefined;

  return (
    samples: ControllerSample[]
  ): ScreenshotGamepadButton[] | undefined => {
    for (const index of waitForRelease) {
      if (
        !samples.some(
          (sample) => sample.index === index && sample.buttons.length
        )
      ) {
        waitForRelease.delete(index);
      }
    }
    if (!active) {
      active = samples.find(
        ({ index, buttons }) => buttons.length > 0 && !waitForRelease.has(index)
      );
      return;
    }

    const current = samples.find((sample) => sample.index === active?.index);
    if (!current) {
      active = undefined;
      // Require all still-held buttons to release after disconnecting the active pad.
      for (const sample of samples) {
        if (sample.buttons.length) waitForRelease.add(sample.index);
      }
      return;
    }
    if (current.buttons.length === 0) {
      const { buttons } = active;
      active = undefined;
      return buttons;
    }
    if (current.buttons.length >= active.buttons.length) active = current;
    return undefined;
  };
}
