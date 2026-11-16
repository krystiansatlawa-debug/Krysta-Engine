import { useTranslation } from "react-i18next";
import { SettingsDebrid } from "./settings-debrid";
import { SettingsRetroAchievements } from "./settings-retroachievements";
import { SettingsSteam } from "./settings-steam";
import { SettingsIntegrationCard } from "./settings-integration-card";
import { SettingsEpic } from "./settings-epic";

export function SettingsContextIntegrations() {
  const { t } = useTranslation("settings");

  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <SettingsSteam />
        <SettingsEpic />
        <SettingsIntegrationCard
          title="Ubisoft Connect"
          logo={<span aria-hidden="true" style={{fontWeight: 800, fontSize: 22}}>U</span>}
          status={document.documentElement.lang.startsWith("pl") ? "Niepołączono" : "Not connected"}
          actions={<a href="https://ubisoftconnect.com/" target="_blank" rel="noreferrer">{document.documentElement.lang.startsWith("pl") ? "Otwórz Ubisoft Connect" : "Open Ubisoft Connect"}</a>}
        >
          <p>{document.documentElement.lang.startsWith("pl") ? "Import biblioteki i łączenie konta nie są jeszcze dostępne." : "Library import and account linking are not yet available."}</p>
        </SettingsIntegrationCard>
        <SettingsRetroAchievements />
      </div>

      <hr className="settings-context-panel__divider" />

      <div className="settings-context-panel__group">
        <h3>{t("debrid_services")}</h3>
        <SettingsDebrid />
      </div>
    </div>
  );
}
