import { useTranslation } from "react-i18next";
import cn from "classnames";

import { Button } from "@renderer/components";
import {
  DEFAULT_SCREENSHOT_GAMEPAD_COMBO,
  SCREENSHOT_GAMEPAD_COMBO_MAX_BUTTONS,
  isSameScreenshotGamepadCombo,
  recordingControllerLabel,
  useControllerShortcutRecorder,
} from "@shared";
import type { ScreenshotGamepadButton } from "@types";

interface SettingsControllerShortcutProps {
  label: string;
  hint: string;
  combo: ScreenshotGamepadButton[];
  disabled: boolean;
  onChange: (combo: ScreenshotGamepadButton[]) => void | Promise<void>;
  reset?: {
    label: string;
    buttons: readonly ScreenshotGamepadButton[];
  };
}

export function SettingsControllerShortcut({
  label,
  hint,
  combo,
  disabled,
  onChange,
  reset,
}: Readonly<SettingsControllerShortcutProps>) {
  const { t } = useTranslation("controller_shortcuts");
  const capture = useControllerShortcutRecorder(
    window.electron,
    disabled,
    onChange
  );
  const canReset = reset && !isSameScreenshotGamepadCombo(combo, reset.buttons);

  return (
    <div
      className={cn("settings-screenshots__field", {
        "settings-screenshots__field--disabled": disabled,
      })}
    >
      <span className="settings-screenshots__field-label">{label}</span>
      <small className="settings-screenshots__hint" aria-live="polite">
        {capture.listening ? t("listening") : hint}
      </small>
      <fieldset className="settings-screenshots__combo" aria-label={label}>
        <span>{recordingControllerLabel(combo) || t("unassigned")}</span>
        <Button
          className="settings-screenshots__combo-reset"
          theme="outline"
          size="small"
          disabled={disabled}
          aria-pressed={capture.listening}
          onClick={capture.listening ? capture.cancel : capture.start}
        >
          {capture.listening ? t("cancel") : t("capture")}
        </Button>
        {canReset && (
          <Button
            className="settings-screenshots__combo-reset"
            theme="outline"
            size="small"
            disabled={disabled || capture.listening}
            onClick={() => void onChange([...reset.buttons])}
          >
            {reset.label}
          </Button>
        )}
      </fieldset>
      {capture.error && (
        <small className="settings-screenshots__error" role="alert">
          {t(capture.error, { limit: SCREENSHOT_GAMEPAD_COMBO_MAX_BUTTONS })}
        </small>
      )}
    </div>
  );
}

export function SettingsScreenshotsGamepad(
  props: Readonly<
    Pick<SettingsControllerShortcutProps, "combo" | "disabled" | "onChange">
  >
) {
  const { t } = useTranslation("settings");
  return (
    <SettingsControllerShortcut
      {...props}
      label={t("screenshots_gamepad_combo")}
      hint={t("screenshots_gamepad_combo_hint")}
      reset={{
        label: t("screenshots_gamepad_reset"),
        buttons: DEFAULT_SCREENSHOT_GAMEPAD_COMBO,
      }}
    />
  );
}
