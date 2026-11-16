import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { changeLanguage } from "i18next";
import { orderBy } from "lodash-es";

import {
  Button,
  CheckboxField,
  SelectField,
  TextField,
} from "@renderer/components";
import type { DownloadDirectoryPreference, UserPreferences } from "@types";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
import languageResources from "@locales";
import {
  prepareDefaultDownloadPathSync,
  replaceSavedDownloadDirectoryAndSetDefault,
} from "@shared";
import { SettingsAppearance } from "./appearance/settings-appearance";
import { DownloadDirectoryReplacementModal } from "./download-directory-replacement-modal";
import "./settings-general.scss";

interface LanguageOption {
  option: string;
  nativeName: string;
}

const LANGUAGE_OPTIONS: LanguageOption[] = orderBy(
  Object.entries(languageResources).map(([language, value]) => ({
    nativeName: value.language_name,
    option: language,
  })),
  ["nativeName"],
  "asc"
);

interface SettingsContextGeneralProps {
  appearance: {
    theme: string | null;
    authorId: string | null;
    authorName: string | null;
  };
}

interface DownloadDirectoryReplacementState {
  nextPath: string;
  replaceableDirectories: DownloadDirectoryPreference[];
  selectedReplacementPath: string;
}

const resolveLanguage = (language: string | undefined) => {
  const languageKeys = Object.keys(languageResources);

  return (
    languageKeys.find((languageKey) => languageKey === language) ??
    languageKeys.find((languageKey) =>
      languageKey.startsWith(language?.split("-")[0] ?? "en")
    ) ??
    "en"
  );
};

const buildForm = (
  preferences: UserPreferences | null,
  defaultDownloadsPath: string
) => ({
  downloadsPath: preferences?.downloadsPath ?? defaultDownloadsPath,
  language: resolveLanguage(preferences?.language),
  preferQuitInsteadOfHiding: preferences?.preferQuitInsteadOfHiding ?? false,
  runAtStartup: preferences?.runAtStartup ?? false,
  startMinimized: preferences?.startMinimized ?? false,
  hideToTrayOnGameStart: preferences?.hideToTrayOnGameStart ?? false,
  launchToLibraryPage: preferences?.launchToLibraryPage ?? false,
  enableAutoInstall: preferences?.enableAutoInstall ?? false,
  useNativeWindowDecorations: preferences?.useNativeWindowDecorations ?? false,
  openFriendsWindowOnStartup: preferences?.openFriendsWindowOnStartup ?? false,
});

export function SettingsContextGeneral({
  appearance,
}: Readonly<SettingsContextGeneralProps>) {
  const { t, i18n } = useTranslation("settings");
  const pl = i18n.language.startsWith("pl");
  const [repairResults, setRepairResults] = useState<Awaited<ReturnType<typeof window.electron.krystaSettingsRepairStatus>>>(null);
  const [repairing, setRepairing] = useState(false);
  const [repairError, setRepairError] = useState(false);
  useEffect(() => { void window.electron.krystaSettingsRepairStatus().then(setRepairResults).catch(() => {}); }, []);
  const repairSettings = async () => {
    setRepairing(true); setRepairError(false);
    try { setRepairResults(await window.electron.krystaSettingsRepair()); } catch { setRepairError(true); } finally { setRepairing(false); }
  };
  const repairNames = { cloud: "Krysta Cloud", fps: "FPS", updates: pl ? "Aktualizator launchera" : "Launcher updater", "game-updates": pl ? "Aktualizacje gier" : "Game updates" };
  const repairStates = { valid: pl ? "Poprawne" : "Valid", missing: pl ? "Domyślne (brak pliku)" : "Defaults (no file)", restored: pl ? "Przywrócono z kopii" : "Restored from backup", defaults: pl ? "Odzyskano ustawienia domyślne" : "Recovered defaults", error: pl ? "Nie udało się sprawdzić" : "Could not check" };
  const { updateUserPreferences } = useContext(settingsContext);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [defaultDownloadsPath, setDefaultDownloadsPath] = useState("");
  const showRunAtStartup = !window.electron.isPortableVersion;
  const [downloadDirectoryReplacement, setDownloadDirectoryReplacement] =
    useState<DownloadDirectoryReplacementState | null>(null);

  const [form, setForm] = useState(() => buildForm(userPreferences, ""));

  useEffect(() => {
    window.electron.getDefaultDownloadsPath().then((path) => {
      setDefaultDownloadsPath(path);
    });
  }, []);

  useEffect(() => {
    if (!userPreferences) return;

    setForm(buildForm(userPreferences, defaultDownloadsPath));
  }, [userPreferences, defaultDownloadsPath]);

  const handleChange = (values: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...values }));
    updateUserPreferences(values);
  };

  const handleLanguageChange = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const value = event.target.value;
    handleChange({ language: value });
    changeLanguage(value);
  };

  const handleChooseDownloadsPath = async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      defaultPath: form.downloadsPath,
      properties: ["openDirectory"],
    });

    const path = filePaths?.[0];

    if (!path || !defaultDownloadsPath) {
      return;
    }

    const nextAction = prepareDefaultDownloadPathSync(
      userPreferences,
      path,
      defaultDownloadsPath
    );

    if (nextAction.type === "noop") {
      return;
    }

    if (
      nextAction.type === "set-existing" ||
      nextAction.type === "add-and-set"
    ) {
      setForm((prev) => ({
        ...prev,
        downloadsPath: nextAction.nextDefaultPath,
      }));
      await updateUserPreferences(nextAction.nextPreferences);
      return;
    }

    setDownloadDirectoryReplacement({
      nextPath: nextAction.nextPath,
      replaceableDirectories: nextAction.replaceableDirectories,
      selectedReplacementPath: nextAction.recommendedReplacementPath,
    });
  };

  const handleConfirmDownloadDirectoryReplacement = async () => {
    if (!downloadDirectoryReplacement || !defaultDownloadsPath) {
      return;
    }

    const replacement = replaceSavedDownloadDirectoryAndSetDefault(
      userPreferences,
      downloadDirectoryReplacement.nextPath,
      downloadDirectoryReplacement.selectedReplacementPath,
      defaultDownloadsPath
    );

    setForm((prev) => ({
      ...prev,
      downloadsPath: replacement.nextDefaultPath,
    }));
    setDownloadDirectoryReplacement(null);
    await updateUserPreferences(replacement.nextPreferences);
  };

  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <h3>{t("app_basics")}</h3>

        <TextField
          label={t("downloads_path")}
          value={form.downloadsPath}
          readOnly
          disabled
          rightContent={
            <Button theme="outline" onClick={handleChooseDownloadsPath}>
              {t("change")}
            </Button>
          }
        />

        <SelectField
          label={t("language")}
          value={form.language}
          onChange={handleLanguageChange}
          options={LANGUAGE_OPTIONS.map((language) => ({
            key: language.option,
            value: language.option,
            label: language.nativeName,
          }))}
        />
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("startup_behavior")}</h3>

        <CheckboxField
          label={t("quit_app_instead_hiding")}
          checked={form.preferQuitInsteadOfHiding}
          onChange={() =>
            handleChange({
              preferQuitInsteadOfHiding: !form.preferQuitInsteadOfHiding,
            })
          }
        />

        <CheckboxField
          label={t("hide_to_tray_on_game_start")}
          checked={form.hideToTrayOnGameStart}
          onChange={() =>
            handleChange({
              hideToTrayOnGameStart: !form.hideToTrayOnGameStart,
            })
          }
        />

        {showRunAtStartup && (
          <CheckboxField
            label={t("launch_with_system")}
            onChange={() => {
              handleChange({ runAtStartup: !form.runAtStartup });
              window.electron.autoLaunch({
                enabled: !form.runAtStartup,
                minimized: form.startMinimized,
              });
            }}
            checked={form.runAtStartup}
          />
        )}

        {showRunAtStartup && (
          <CheckboxField
            label={t("launch_minimized")}
            style={{ cursor: form.runAtStartup ? "pointer" : "not-allowed" }}
            checked={form.runAtStartup && form.startMinimized}
            disabled={!form.runAtStartup}
            onChange={() => {
              handleChange({ startMinimized: !form.startMinimized });
              window.electron.autoLaunch({
                minimized: !form.startMinimized,
                enabled: form.runAtStartup,
              });
            }}
          />
        )}

        <CheckboxField
          label={t("launch_hydra_in_library_page")}
          checked={form.launchToLibraryPage}
          onChange={() =>
            handleChange({
              launchToLibraryPage: !form.launchToLibraryPage,
            })
          }
        />

        <CheckboxField
          label={t("open_friends_window_on_startup")}
          checked={form.openFriendsWindowOnStartup}
          onChange={() =>
            handleChange({
              openFriendsWindowOnStartup: !form.openFriendsWindowOnStartup,
            })
          }
        />
      </div>

      {window.electron.platform === "linux" && (
        <div className="settings-context-panel__group">
          <h3>{t("behavior")}</h3>

          <CheckboxField
            label={t("enable_auto_install")}
            checked={form.enableAutoInstall}
            onChange={() =>
              handleChange({ enableAutoInstall: !form.enableAutoInstall })
            }
          />

          <CheckboxField
            label={
              <span className="settings-general__hinted-label">
                {t("use_native_window_decorations")}
                <small>{t("use_native_window_decorations_hint")}</small>
              </span>
            }
            checked={form.useNativeWindowDecorations}
            onChange={() =>
              handleChange({
                useNativeWindowDecorations: !form.useNativeWindowDecorations,
              })
            }
          />
        </div>
      )}

      <div className="settings-context-panel__group">
        <h3>{t("appearance")}</h3>
        <SettingsAppearance appearance={appearance} />
      </div>

      <div className="settings-context-panel__group">
        <h3>{pl ? "Naprawa ustawień Krysty" : "Krysta settings repair"}</h3>
        <p>{pl ? "Sprawdza ustawienia modułów Krysty i naprawia wyłącznie uszkodzone pliki. Biblioteka, konta i zapisy gier nie są usuwane." : "Checks Krysta module settings and repairs only damaged files. Library, accounts and game saves are not deleted."}</p>
        <Button theme="outline" disabled={repairing} onClick={() => void repairSettings()}>{repairing ? (pl ? "Sprawdzanie…" : "Checking…") : (pl ? "Sprawdź i napraw ustawienia" : "Check and repair settings")}</Button>
        {repairResults && <div role="status">{repairResults.map(item => <p key={item.name}>{repairNames[item.name]}: {repairStates[item.state]}</p>)}</div>}
        {repairResults?.some(item => item.state === "restored" || item.state === "defaults") && <p>{pl ? "Uruchom ponownie Krystę, aby wszystkie moduły odczytały odzyskane ustawienia." : "Restart Krysta to reload recovered settings in every module."}</p>}
        {repairError && <p role="alert">{pl ? "Nie udało się uruchomić naprawy." : "Could not start repair."}</p>}
      </div>

      <DownloadDirectoryReplacementModal
        visible={downloadDirectoryReplacement !== null}
        nextPath={downloadDirectoryReplacement?.nextPath ?? ""}
        directories={downloadDirectoryReplacement?.replaceableDirectories ?? []}
        selectedReplacementPath={
          downloadDirectoryReplacement?.selectedReplacementPath ?? ""
        }
        onSelectedReplacementPathChange={(path) => {
          setDownloadDirectoryReplacement((current) =>
            current
              ? {
                  ...current,
                  selectedReplacementPath: path,
                }
              : current
          );
        }}
        onClose={() => setDownloadDirectoryReplacement(null)}
        onConfirm={handleConfirmDownloadDirectoryReplacement}
      />
    </div>
  );
}
