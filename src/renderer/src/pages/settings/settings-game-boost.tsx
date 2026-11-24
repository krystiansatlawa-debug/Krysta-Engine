import { FileDirectoryIcon, TrashIcon } from "@primer/octicons-react";
import { Button, CheckboxField, TextField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
import { getGameBoostPreferences, MAX_GAME_BOOST_APPLICATIONS } from "@shared";
import type { UserPreferences } from "@types";
import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";

export function SettingsGameBoost() {
  const { t } = useTranslation("settings");
  const { updateUserPreferences } = useContext(settingsContext);
  const preferences = useAppSelector((state) => state.userPreferences.value);
  const {
    enabled,
    closeApplications,
    restoreApplications,
  } = getGameBoostPreferences(preferences);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      setError(t("game_boost_settings_error"));
    } finally {
      setBusy(false);
    }
  };

  const save = (values: Partial<UserPreferences>) =>
    apply(() => updateUserPreferences(values));

  const addApplications = () =>
    apply(async () => {
      const { canceled, filePaths } = await window.electron.showOpenDialog({
        properties: ["openFile", "multiSelections"],
        filters: [
          { name: t("game_boost_executable_filter"), extensions: ["exe"] },
        ],
      });

      if (canceled) return;

      const next = new Map(
        closeApplications.map((application) => [
          application.toLowerCase(),
          application,
        ])
      );
      for (const application of filePaths) {
        const key = application.toLowerCase();
        if (key.endsWith(".exe") && !next.has(key)) next.set(key, application);
      }

      if (next.size > MAX_GAME_BOOST_APPLICATIONS) {
        setError(
          t("game_boost_apps_limit", { limit: MAX_GAME_BOOST_APPLICATIONS })
        );
      } else if (next.size !== closeApplications.length) {
        await updateUserPreferences({
          gameBoostCloseApplications: [...next.values()],
        });
        const saved = getGameBoostPreferences(
          await window.electron.getUserPreferences()
        );
        if (saved.closeApplications.length < next.size) {
          setError(t("game_boost_app_unavailable"));
        }
      }
    });

  return (
    <section
      className="settings-context-panel__group"
      aria-labelledby="game-boost-heading"
    >
      <h3 id="game-boost-heading">{t("game_boost_heading")}</h3>
      <CheckboxField
        label={t("game_boost_enabled")}
        checked={enabled}
        disabled={busy}
        onChange={(event) =>
          void save({ gameBoostEnabled: event.currentTarget.checked })
        }
      />
      <p>{t("game_boost_pause_sync")}</p>

      {window.electron.platform === "win32" && (
        <>
          <h4>{t("game_boost_background_apps")}</h4>
          <p>{t("game_boost_background_apps_hint")}</p>
          <Button theme="outline" disabled={busy} onClick={() => void apply(async () => setCandidates(await window.electron.listGameBoostCandidates()))}>
            {t("game_boost_scan_apps", { defaultValue: "Detect running applications / Wykryj działające aplikacje" })}
          </Button>
          {candidates.filter(exe => !closeApplications.some(p => p.toLowerCase() === exe.toLowerCase())).map(exe => (
            <Button key={exe} theme="outline" disabled={busy || closeApplications.length >= MAX_GAME_BOOST_APPLICATIONS} onClick={() => void save({ gameBoostCloseApplications: [...closeApplications, exe] })}>{exe}</Button>
          ))}
          {closeApplications.map((application) => (
            <TextField
              key={application}
              aria-label={t("game_boost_executable_path")}
              readOnly
              value={application}
              rightContent={
                <Button
                  theme="outline"
                  disabled={busy}
                  aria-label={t("game_boost_remove_app", { application })}
                  onClick={() =>
                    void save({
                      gameBoostCloseApplications: closeApplications.filter(
                        (path) => path !== application
                      ),
                    })
                  }
                >
                  <TrashIcon size={16} />
                </Button>
              }
            />
          ))}
          <Button
            theme="outline"
            disabled={
              busy || closeApplications.length >= MAX_GAME_BOOST_APPLICATIONS
            }
            onClick={() => void addApplications()}
          >
            <FileDirectoryIcon size={16} />
            {t("game_boost_add_apps")}
          </Button>
          <CheckboxField
            label={t("game_boost_restore_apps")}
            checked={restoreApplications}
            disabled={!enabled || busy}
            onChange={(event) =>
              void save({
                gameBoostRestoreApplications: event.currentTarget.checked,
              })
            }
          />
        </>
      )}

      {error && <p role="alert">{error}</p>}
    </section>
  );
}
