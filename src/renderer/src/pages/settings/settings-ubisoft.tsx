import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LinkExternalIcon, SyncIcon } from "@primer/octicons-react";
import { Button } from "@renderer/components";
import { SettingsIntegrationCard, SettingsIntegrationLastSynced } from "./settings-integration-card";

export function SettingsUbisoft() {
  const { i18n } = useTranslation("settings");
  const pl = i18n.language.startsWith("pl");
  const [installed, setInstalled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    void window.electron.scanUbisoft().then(result => setInstalled(result.installed)).catch(() => {});
  }, []);
  const openLogin = async () => {
    try { await window.electron.openExternal("https://account.ubisoft.com/"); }
    catch { setNotice(pl ? "Nie udało się otworzyć strony Ubisoft." : "Could not open Ubisoft."); }
  };
  const sync = async () => {
    setBusy(true); setNotice("");
    try {
      const count = await window.electron.importUbisoft();
      setLastSync(new Date().toISOString());
      setNotice(pl ? "Dodano gier: " + count : "Games added: " + count);
    } catch { setNotice(pl ? "Import nie powiódł się." : "Import failed."); }
    finally { setBusy(false); }
  };
  return (
    <SettingsIntegrationCard title="Ubisoft Connect"
      logo={<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M4 8c9-10 21 3 11 10-6 4-13-4-7-8 4-3 9 2 5 5"/></svg>}
      status={pl ? "Konto niepołączone" : "Account not linked"}
      actions={<>
        <Button onClick={() => void openLogin()}><LinkExternalIcon size={14}/>{pl ? "Zaloguj się w Ubisoft" : "Sign in at Ubisoft"}</Button>
        {installed && <Button theme="outline" disabled={busy} onClick={() => void sync()}><SyncIcon size={14}/>{pl ? "Import lokalny" : "Local import"}</Button>}
      </>}>
      <p className="settings-integration-card__description">{pl ? "Logowanie odbywa się na oficjalnej stronie Ubisoft. Łączenie konta i synchronizacja pełnej biblioteki nie są jeszcze dostępne. Możesz importować zainstalowane gry bezpośrednio do biblioteki Krysta." : "Sign in on Ubisoft's official website. Account linking and full library sync are not yet available. Installed games can be imported into your Krysta library."}</p>
      {lastSync && <SettingsIntegrationLastSynced lastSyncedAt={lastSync}/>}
      {busy && <p role="status">{pl ? "Importowanie..." : "Importing..."}</p>}
      {notice && <p role="status">{notice}</p>}
    </SettingsIntegrationCard>
  );
}
