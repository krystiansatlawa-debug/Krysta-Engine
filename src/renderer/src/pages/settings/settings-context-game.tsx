import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { KrystaGameUpdateSettings } from "./krysta-game-update-settings";
import { SettingsGameBoost } from "./settings-game-boost";
import { CheckboxField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";

export function SettingsContextGame() {
  const { i18n, t } = useTranslation("settings");
  const pl = i18n.language.startsWith("pl");
  const { updateUserPreferences } = useContext(settingsContext);
  const guideShortcutEnabled = useAppSelector(
    (state) => state.userPreferences.value?.xboxGuideGameShortcutEnabled === true
  );
  const [guideShortcutError, setGuideShortcutError] = useState(false);
  const [gameBarControllerEnabled, setGameBarControllerEnabled] = useState<
    boolean | null
  >(null);
  const [gameBarControllerBusy, setGameBarControllerBusy] = useState(false);
  const [gameBarControllerError, setGameBarControllerError] = useState(false);
  useEffect(() => {
    if (window.electron.platform !== "win32") return;

    let active = true;
    void window.electron
      .getWindowsGameBarControllerEnabled()
      .then((value) => {
        if (!active) return;
        setGameBarControllerEnabled(value);
        setGameBarControllerError(value === null);
      })
      .catch(() => {
        if (active) setGameBarControllerError(true);
      });

    return () => {
      active = false;
    };
  }, []);
  const setGameBarControllerShortcut = async (enabled: boolean) => {
    setGameBarControllerBusy(true);
    setGameBarControllerError(false);
    try {
      const value =
        await window.electron.setWindowsGameBarControllerEnabled(enabled);
      setGameBarControllerEnabled(value);
      setGameBarControllerError(value !== enabled);
    } catch {
      setGameBarControllerError(true);
    } finally {
      setGameBarControllerBusy(false);
    }
  };
  return (
    <div className="settings-context-panel">
      <SettingsGameBoost />
      <KrystaGameUpdateSettings />
      {window.electron.platform === "win32" && (
        <div className="settings-context-panel__group">
          <h3>{pl ? "Kontroler Xbox" : "Xbox controller"}</h3>
          <CheckboxField
            label={
              pl
                ? "Przycisk Xbox minimalizuje i przywraca grę"
                : "Use the Xbox button to minimize and restore the game"
            }
            checked={guideShortcutEnabled}
            onChange={() => {
              setGuideShortcutError(false);
              void updateUserPreferences({
                xboxGuideGameShortcutEnabled: !guideShortcutEnabled,
              }).catch(() => setGuideShortcutError(true));
            }}
          />
          <p>{t("krysta_xbox_fullscreen_hint")}</p>
          {guideShortcutError && (
            <p role="alert">
              {pl
                ? "Nie udało się zapisać ustawienia kontrolera."
                : "Could not save the controller setting."}
            </p>
          )}
          <CheckboxField
            label={t("windows_game_bar_controller_label")}
            checked={gameBarControllerEnabled === true}
            disabled={
              gameBarControllerEnabled === null || gameBarControllerBusy
            }
            onChange={(event) =>
              void setGameBarControllerShortcut(event.currentTarget.checked)
            }
          />
          <small>{t("windows_game_bar_controller_hint")}</small>
          {gameBarControllerError && (
            <p role="alert">{t("windows_game_bar_controller_error")}</p>
          )}
        </div>
      )}
    </div>
  );
}
