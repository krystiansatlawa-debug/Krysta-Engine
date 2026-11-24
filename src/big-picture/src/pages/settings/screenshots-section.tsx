import "./screenshots-section.scss";

import {
  ArrowCounterClockwiseIcon,
  FolderOpenIcon,
  KeyboardIcon,
} from "@phosphor-icons/react";
import cn from "classnames";
import { isEqual } from "lodash-es";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ProfileVisibility,
  ScreenshotGamepadButton,
  ScreenshotInputStatus,
  UserPreferences,
} from "@types";
import {
  DEFAULT_SCREENSHOT_GAMEPAD_COMBO,
  DEFAULT_SCREENSHOT_HOTKEY,
  SCREENSHOT_GAMEPAD_COMBO_MAX_BUTTONS,
  formatScreenshotHotkey,
  isSameScreenshotGamepadCombo,
  isSameScreenshotHotkey,
  resolveScreenshotPreferences,
  validateScreenshotHotkey,
  recordingControllerLabel,
  useControllerShortcutRecorder,
  type ScreenshotHotkeyError,
} from "@shared";
import { logger } from "@renderer/logger";

import {
  Button,
  Checkbox,
  DropdownSelect,
  FocusItem,
  HorizontalFocusGroup,
  VerticalFocusGroup,
  type DropdownSelectOption,
} from "../../components";
import {
  createScreenshotHotkeyRecorder,
  isPrintScreenKeyCode,
} from "../../components/pages/screenshots";
import {
  useBigPictureToast,
  useNavigation,
  useNavigationScreenActions,
  useUserPreferences,
} from "../../hooks";
import {
  GamepadService,
  NavigationService,
  type FocusOverrides,
  type FocusOverrideTarget,
} from "../../services";
import { SettingsSection } from "./settings-section";

export const SCREENSHOT_SETTINGS_FOCUS_IDS = {
  enabled: "screenshot-settings-enabled",
  hotkey: "screenshot-settings-hotkey",
  hotkeyReset: "screenshot-settings-hotkey-reset",
  gamepadEnabled: "screenshot-settings-gamepad-enabled",
  gamepadCapture: "screenshot-settings-gamepad-capture",
  gamepadReset: "screenshot-settings-gamepad-reset",
  captureSound: "screenshot-settings-capture-sound",
  toast: "screenshot-settings-toast",
  defaultVisibility: "screenshot-settings-default-visibility",
  hideCommunity: "screenshot-settings-hide-community",
  folder: "screenshot-settings-folder",
  folderReset: "screenshot-settings-folder-reset",
  folderOpen: "screenshot-settings-folder-open",
} as const;

const SECTION_REGION_ID = "screenshot-settings-section";
const navigationService = NavigationService.getInstance();
const HOTKEY_ERROR_KEYS: Record<ScreenshotHotkeyError, string> = {
  hotkey_reserved: "screenshots_hotkey_error_reserved",
  hotkey_modifier_required: "screenshots_hotkey_error_typing",
  hotkey_unsupported_key: "screenshots_hotkey_error_unsupported",
};
const BLOCK_TARGET: FocusOverrideTarget = { type: "block" };

const pauseGamepadNavigation = () => GamepadService.getInstance().pauseInput();

type ScreenshotPreferenceUpdate = Pick<
  UserPreferences,
  | "screenshotsEnabled"
  | "screenshotHotkey"
  | "screenshotGamepadEnabled"
  | "screenshotGamepadCombo"
  | "screenshotCaptureSoundEnabled"
  | "screenshotToastEnabled"
  | "screenshotDefaultVisibility"
  | "hideCommunityScreenshots"
>;

function withoutPreferenceKeys(
  overrides: ScreenshotPreferenceUpdate,
  shouldDrop: (key: string, value: unknown) => boolean
): ScreenshotPreferenceUpdate {
  const entries = Object.entries(overrides);
  const kept = entries.filter(([key, value]) => !shouldDrop(key, value));
  if (kept.length === entries.length) return overrides;

  return Object.fromEntries(kept) as ScreenshotPreferenceUpdate;
}

export function buildRowNavigation(
  rows: string[][],
  upTarget: FocusOverrideTarget,
  downTarget: FocusOverrideTarget
) {
  const overrides: Record<string, FocusOverrides> = {};

  rows.forEach((row, rowIndex) => {
    const previousRow = rows[rowIndex - 1];
    const nextRow = rows[rowIndex + 1];

    row.forEach((focusId, columnIndex) => {
      const up = previousRow?.[Math.min(columnIndex, previousRow.length - 1)];
      const down = nextRow?.[Math.min(columnIndex, nextRow.length - 1)];
      const left = row[columnIndex - 1];
      const right = row[columnIndex + 1];

      overrides[focusId] = {
        up: up ? { type: "item", itemId: up } : upTarget,
        down: down ? { type: "item", itemId: down } : downTarget,
        left: left ? { type: "item", itemId: left } : undefined,
        right: right ? { type: "item", itemId: right } : BLOCK_TARGET,
      };
    });
  });

  return overrides;
}

function useHotkeyRecorder(
  onRecorded: (error: ScreenshotHotkeyError | null) => void,
  save: (binding: UserPreferences["screenshotHotkey"]) => void
) {
  const [isRecording, setIsRecording] = useState(false);

  useNavigationScreenActions(
    isRecording ? { press: { b: () => setIsRecording(false) } } : {}
  );

  useEffect(() => {
    if (!isRecording) return;

    const recordingLayerId = navigationService.getActiveLayerId();
    const isRecordingLayerActive = () =>
      navigationService.getActiveLayerId() === recordingLayerId;
    const unsubscribe = navigationService.subscribe(() => {
      if (!isRecordingLayerActive()) setIsRecording(false);
    });

    const recorder = createScreenshotHotkeyRecorder((candidate) => {
      const validation = validateScreenshotHotkey(candidate);
      const { meta: _meta, ...binding } = candidate;
      const error = validation.valid ? null : validation.error;

      setIsRecording(false);
      onRecorded(error);
      if (!error) save(binding);
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isRecordingLayerActive()) return;

      event.preventDefault();
      event.stopPropagation();

      if (event.code === "Escape" && !event.ctrlKey && !event.altKey) {
        setIsRecording(false);
        return;
      }

      recorder.handleKeyDown(event);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (!isRecordingLayerActive()) return;

      if (isPrintScreenKeyCode(event.code)) {
        event.preventDefault();
        event.stopPropagation();
      }

      recorder.handleKeyUp(event);
    };

    const onBlur = () => recorder.forgetModifiers();

    globalThis.window.addEventListener("keydown", onKeyDown, true);
    globalThis.window.addEventListener("keyup", onKeyUp, true);
    globalThis.window.addEventListener("blur", onBlur);
    return () => {
      unsubscribe();
      globalThis.window.removeEventListener("keydown", onKeyDown, true);
      globalThis.window.removeEventListener("keyup", onKeyUp, true);
      globalThis.window.removeEventListener("blur", onBlur);
    };
  }, [isRecording, onRecorded, save]);

  return { isRecording, setIsRecording };
}

function useScreenshotInputStatus() {
  const [status, setStatus] = useState<ScreenshotInputStatus | null>(null);

  useEffect(() => {
    let isCurrent = true;

    globalThis.window.electron
      .getScreenshotInputStatus()
      .then((nextStatus) => {
        if (isCurrent) setStatus(nextStatus);
      })
      .catch((error: unknown) => {
        logger.error("Failed to read the screenshot input status", error);
      });

    const unsubscribe =
      globalThis.window.electron.onScreenshotInputStatusChange(setStatus);

    return () => {
      isCurrent = false;
      unsubscribe();
    };
  }, []);

  return status;
}

function getInputStatusKey(status: ScreenshotInputStatus) {
  if (status.keyboardBackend === "unavailable")
    return "screenshots_input_unavailable";
  if (status.active) return "screenshots_input_active";

  return "screenshots_input_idle";
}

function ScreenshotInputStatusLine({
  status,
}: Readonly<{ status: ScreenshotInputStatus | null }>) {
  const { t } = useTranslation("settings");

  if (!status) return null;

  return (
    <span className="screenshot-settings__status">
      <span className="screenshot-settings__hint">
        {t(getInputStatusKey(status))}
      </span>
      {status.hint ? (
        <span className="screenshot-settings__hint">
          {t(status.hint, { ns: "screenshots_input" })}
        </span>
      ) : null}
    </span>
  );
}

interface ScreenshotSettingsRowsOptions {
  isDefaultHotkey: boolean;
  hasCustomFolder: boolean;
  isDefaultCombo: boolean;
  settingsDisabled: boolean;
  isGamepadComboDisabled: boolean;
}

const ids = SCREENSHOT_SETTINGS_FOCUS_IDS;

function getInactiveFocusIds(
  options: ScreenshotSettingsRowsOptions,
  comboIds: string[]
) {
  const inactiveIds = new Set<string>();

  if (options.settingsDisabled) {
    inactiveIds.add(ids.hotkey);
    inactiveIds.add(ids.hotkeyReset);
    inactiveIds.add(ids.defaultVisibility);
  }
  if (options.isGamepadComboDisabled) {
    for (const focusId of comboIds) inactiveIds.add(focusId);
  }

  return inactiveIds;
}

function buildScreenshotSettingsRows(options: ScreenshotSettingsRowsOptions) {
  const hotkeyRow = options.isDefaultHotkey
    ? [ids.hotkey]
    : [ids.hotkey, ids.hotkeyReset];
  const folderRow = options.hasCustomFolder
    ? [ids.folder, ids.folderReset, ids.folderOpen]
    : [ids.folder, ids.folderOpen];
  const comboRow = options.isDefaultCombo
    ? [ids.gamepadCapture]
    : [ids.gamepadCapture, ids.gamepadReset];
  const inactiveIds = getInactiveFocusIds(options, comboRow);

  return [
    [ids.enabled],
    hotkeyRow,
    [ids.gamepadEnabled],
    comboRow,
    [ids.captureSound],
    [ids.toast],
    [ids.defaultVisibility],
    [ids.hideCommunity],
    folderRow,
  ]
    .map((row) => row.filter((focusId) => !inactiveIds.has(focusId)))
    .filter((row) => row.length > 0);
}

interface ScreenshotSettingsSectionProps {
  upTarget: FocusOverrideTarget;
}

export function ScreenshotSettingsSection({
  upTarget,
}: Readonly<ScreenshotSettingsSectionProps>) {
  const { t } = useTranslation("big_picture");
  const userPreferences = useUserPreferences();
  const { showErrorToast } = useBigPictureToast();
  const { setFocus } = useNavigation();
  const [overrides, setOverrides] = useState<ScreenshotPreferenceUpdate>({});
  const [folderPath, setFolderPath] = useState("");
  const inputStatus = useScreenshotInputStatus();
  const preferences = resolveScreenshotPreferences({
    ...userPreferences,
    ...overrides,
  });
  const hasCustomFolder = Boolean(userPreferences?.screenshotsFolderPath);
  const settingsDisabled = !preferences.enabled;

  useEffect(() => {
    setOverrides((current) =>
      withoutPreferenceKeys(current, (key, value) =>
        isEqual(value, userPreferences?.[key as keyof UserPreferences])
      )
    );
  }, [userPreferences]);

  const refreshFolderPath = useCallback(async () => {
    try {
      setFolderPath(
        await globalThis.window.electron.getScreenshotsFolderPath()
      );
    } catch (error) {
      logger.error("Failed to resolve the screenshots folder", error);
    }
  }, []);

  useEffect(() => {
    void refreshFolderPath();
  }, [refreshFolderPath, userPreferences?.screenshotsFolderPath]);

  const update = useCallback(
    async (values: ScreenshotPreferenceUpdate) => {
      setOverrides((current) => ({ ...current, ...values }));

      try {
        await globalThis.window.electron.updateUserPreferences(values);
      } catch (error) {
        logger.error("Failed to save screenshot preferences", error);
        setOverrides((current) =>
          withoutPreferenceKeys(current, (key) => Object.hasOwn(values, key))
        );
        showErrorToast(t("screenshots_settings_save_failed"), {
          fallbackVisual: "settings",
        });
      }
    },
    [showErrorToast, t]
  );

  const handleRecorded = useCallback(
    (error: ScreenshotHotkeyError | null) => {
      if (!error) return;

      showErrorToast(t(HOTKEY_ERROR_KEYS[error]), {
        fallbackVisual: "settings",
      });
    },
    [showErrorToast, t]
  );

  const saveHotkey = useCallback(
    (binding: UserPreferences["screenshotHotkey"]) => {
      void update({ screenshotHotkey: binding });
    },
    [update]
  );

  const { isRecording, setIsRecording } = useHotkeyRecorder(
    handleRecorded,
    saveHotkey
  );

  const showSaveFailed = (message: string, error: unknown) => {
    logger.error(message, error);
    showErrorToast(t("screenshots_settings_save_failed"), {
      fallbackVisual: "settings",
    });
  };

  const chooseFolder = async () => {
    try {
      const result = await globalThis.window.electron.showOpenDialog({
        defaultPath: folderPath || undefined,
        properties: ["openDirectory"],
      });
      const selectedPath = result.filePaths[0];
      if (result.canceled || !selectedPath) return;

      await globalThis.window.electron.updateUserPreferences({
        screenshotsFolderPath: selectedPath,
      });
    } catch (error) {
      showSaveFailed("Failed to change the screenshots folder", error);
      return;
    }
    await refreshFolderPath();
  };

  const resetFolder = async () => {
    try {
      await globalThis.window.electron.updateUserPreferences({
        screenshotsFolderPath: undefined,
      });
    } catch (error) {
      showSaveFailed("Failed to reset the screenshots folder", error);
      return;
    }
    await refreshFolderPath();
  };

  const openFolder = async () => {
    try {
      await globalThis.window.electron.openScreenshotsFolder();
    } catch (error) {
      logger.error("Failed to open the screenshots folder", error);
      showErrorToast(t("screenshots_settings_folder_open_failed"), {
        fallbackVisual: "settings",
      });
    }
  };

  const visibilityOptions = useMemo<DropdownSelectOption<ProfileVisibility>[]>(
    () => [
      { value: "PUBLIC", label: t("screenshots_visibility_public") },
      { value: "FRIENDS", label: t("screenshots_visibility_friends") },
      { value: "PRIVATE", label: t("screenshots_visibility_private") },
    ],
    [t]
  );

  const saveGamepadCombo = useCallback(
    (screenshotGamepadCombo: ScreenshotGamepadButton[]) =>
      update({ screenshotGamepadCombo }),
    [update]
  );
  const isGamepadComboDisabled =
    settingsDisabled || !preferences.gamepadEnabled;
  const isDefaultCombo = isSameScreenshotGamepadCombo(
    preferences.gamepadCombo,
    DEFAULT_SCREENSHOT_GAMEPAD_COMBO
  );
  const gamepadCapture = useControllerShortcutRecorder(
    globalThis.window.electron,
    isGamepadComboDisabled || isRecording,
    saveGamepadCombo,
    pauseGamepadNavigation
  );

  const resetHotkey = () => {
    setIsRecording(false);
    void update({ screenshotHotkey: { ...DEFAULT_SCREENSHOT_HOTKEY } });
    globalThis.window.requestAnimationFrame(() =>
      setFocus(SCREENSHOT_SETTINGS_FOCUS_IDS.hotkey)
    );
  };

  const isDefaultHotkey = isSameScreenshotHotkey(
    preferences.hotkey,
    DEFAULT_SCREENSHOT_HOTKEY
  );
  const rows = useMemo(
    () =>
      buildScreenshotSettingsRows({
        isDefaultHotkey,
        hasCustomFolder,
        isDefaultCombo,
        settingsDisabled,
        isGamepadComboDisabled,
      }),
    [
      isDefaultCombo,
      hasCustomFolder,
      isDefaultHotkey,
      isGamepadComboDisabled,
      settingsDisabled,
    ]
  );

  const navigation = useMemo(
    () => buildRowNavigation(rows, upTarget, BLOCK_TARGET),
    [rows, upTarget]
  );

  const renderCheckbox = (
    focusId: string,
    label: string,
    checked: boolean,
    onChange: (checked: boolean) => void,
    disabled = settingsDisabled
  ) => (
    <Checkbox
      block
      label={label}
      checked={checked}
      disabled={disabled}
      focusId={focusId}
      navigationOverrides={navigation[focusId]}
      onChange={onChange}
    />
  );

  return (
    <SettingsSection
      title={t("screenshots_settings_title")}
      description={t("screenshots_settings_description")}
    >
      <VerticalFocusGroup regionId={SECTION_REGION_ID} asChild>
        <div className="screenshot-settings">
          {renderCheckbox(
            ids.enabled,
            t("screenshots_settings_enabled"),
            preferences.enabled,
            (screenshotsEnabled) => void update({ screenshotsEnabled }),
            false
          )}

          <div className="screenshot-settings__row">
            <span className="screenshot-settings__label">
              {t("screenshots_settings_hotkey")}
            </span>
            <HorizontalFocusGroup asChild>
              <div className="screenshot-settings__controls">
                <FocusItem
                  id={ids.hotkey}
                  navigationState={settingsDisabled ? "disabled" : "active"}
                  navigationOverrides={navigation[ids.hotkey]}
                  asChild
                >
                  <button
                    type="button"
                    className={cn("screenshot-settings__keycap", {
                      "screenshot-settings__keycap--recording": isRecording,
                    })}
                    disabled={settingsDisabled}
                    aria-pressed={isRecording}
                    onClick={() => setIsRecording(!isRecording)}
                  >
                    <KeyboardIcon size={18} />
                    <span>
                      {isRecording
                        ? t("screenshots_settings_hotkey_recording")
                        : formatScreenshotHotkey(preferences.hotkey)}
                    </span>
                  </button>
                </FocusItem>
                {isDefaultHotkey ? null : (
                  <Button
                    variant="secondary"
                    size="small"
                    focusId={ids.hotkeyReset}
                    disabled={settingsDisabled}
                    focusNavigationOverrides={navigation[ids.hotkeyReset]}
                    onClick={resetHotkey}
                  >
                    {t("screenshots_settings_hotkey_reset")}
                  </Button>
                )}
              </div>
            </HorizontalFocusGroup>
            <span className="screenshot-settings__hint">
              {t(
                isRecording
                  ? "screenshots_settings_hotkey_recording_hint"
                  : "screenshots_settings_hotkey_hint"
              )}
            </span>
            <ScreenshotInputStatusLine status={inputStatus} />
          </div>

          {renderCheckbox(
            ids.gamepadEnabled,
            t("screenshots_settings_gamepad_enabled"),
            preferences.gamepadEnabled,
            (screenshotGamepadEnabled) =>
              void update({ screenshotGamepadEnabled })
          )}

          <div className="screenshot-settings__row">
            <span className="screenshot-settings__label">
              {t("screenshots_settings_gamepad_combo")}
            </span>
            <HorizontalFocusGroup asChild>
              <div className="screenshot-settings__controls">
                <span>
                  {recordingControllerLabel(preferences.gamepadCombo)}
                </span>
                <Button
                  variant="secondary"
                  size="small"
                  focusId={ids.gamepadCapture}
                  disabled={isGamepadComboDisabled || isRecording}
                  focusNavigationOverrides={navigation[ids.gamepadCapture]}
                  onClick={
                    gamepadCapture.listening
                      ? gamepadCapture.cancel
                      : gamepadCapture.start
                  }
                >
                  {t(gamepadCapture.listening ? "cancel" : "capture", {
                    ns: "controller_shortcuts",
                  })}
                </Button>
                {!isDefaultCombo && (
                  <Button
                    variant="secondary"
                    size="small"
                    focusId={ids.gamepadReset}
                    disabled={
                      isGamepadComboDisabled || gamepadCapture.listening
                    }
                    focusNavigationOverrides={navigation[ids.gamepadReset]}
                    onClick={() =>
                      saveGamepadCombo([...DEFAULT_SCREENSHOT_GAMEPAD_COMBO])
                    }
                  >
                    {t("screenshots_settings_gamepad_reset")}
                  </Button>
                )}
              </div>
            </HorizontalFocusGroup>
            {gamepadCapture.listening && (
              <span className="screenshot-settings__hint" aria-live="polite">
                {t("listening", { ns: "controller_shortcuts" })}
              </span>
            )}
            {gamepadCapture.error && (
              <span className="screenshot-settings__error" role="alert">
                {t(gamepadCapture.error, {
                  ns: "controller_shortcuts",
                  limit: SCREENSHOT_GAMEPAD_COMBO_MAX_BUTTONS,
                })}
              </span>
            )}
          </div>

          {renderCheckbox(
            ids.captureSound,
            t("screenshots_settings_capture_sound"),
            preferences.captureSoundEnabled,
            (screenshotCaptureSoundEnabled) =>
              void update({ screenshotCaptureSoundEnabled })
          )}
          {renderCheckbox(
            ids.toast,
            t("screenshots_settings_toast"),
            preferences.toastEnabled,
            (screenshotToastEnabled) => void update({ screenshotToastEnabled })
          )}

          <DropdownSelect
            className="screenshot-settings__visibility"
            label={t("screenshots_settings_default_visibility")}
            value={preferences.defaultVisibility}
            options={visibilityOptions}
            disabled={settingsDisabled}
            focusId={ids.defaultVisibility}
            focusNavigationOverrides={navigation[ids.defaultVisibility]}
            onValueChange={(screenshotDefaultVisibility) =>
              void update({ screenshotDefaultVisibility })
            }
          />

          {renderCheckbox(
            ids.hideCommunity,
            t("screenshots_settings_hide_community"),
            preferences.hideCommunity,
            (hideCommunityScreenshots) =>
              void update({ hideCommunityScreenshots }),
            false
          )}

          <div className="screenshot-settings__row">
            <span className="screenshot-settings__label">
              {t("screenshots_settings_folder")}
            </span>
            <HorizontalFocusGroup asChild>
              <div className="screenshot-settings__controls">
                <FocusItem
                  id={ids.folder}
                  actions={{ primary: () => void chooseFolder() }}
                  navigationOverrides={navigation[ids.folder]}
                  asChild
                >
                  <button
                    type="button"
                    className="screenshot-settings__path"
                    title={folderPath}
                    onClick={() => void chooseFolder()}
                  >
                    {folderPath}
                  </button>
                </FocusItem>
                {hasCustomFolder ? (
                  <Button
                    variant="secondary"
                    size="icon"
                    focusId={ids.folderReset}
                    icon={<ArrowCounterClockwiseIcon size={18} />}
                    aria-label={t("screenshots_settings_folder_reset")}
                    title={t("screenshots_settings_folder_reset")}
                    focusNavigationOverrides={navigation[ids.folderReset]}
                    onClick={() => void resetFolder()}
                  >
                    {null}
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  focusId={ids.folderOpen}
                  icon={<FolderOpenIcon size={18} />}
                  focusNavigationOverrides={navigation[ids.folderOpen]}
                  onClick={() => void openFolder()}
                >
                  {t("screenshots_settings_folder_open")}
                </Button>
              </div>
            </HorizontalFocusGroup>
          </div>
        </div>
      </VerticalFocusGroup>
    </SettingsSection>
  );
}
