import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, CheckboxField } from "@renderer/components";
export function SettingsContextKrystaCloud() {
  const { i18n } = useTranslation();
  const pl = i18n.language.startsWith("pl");
  const [cfg, setCfg] = useState<{
    provider: string;
    folder?: string;
    autoBackup?: boolean;
    syncBeforeLaunch?: boolean;
    backupScreenshots?: boolean;
    backupRecordings?: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [accounts, setAccounts] = useState<{
    google: boolean;
    synology: boolean;
    googleConfigured?: boolean;
  } | null>(null);
  const [nasUrl, setNasUrl] = useState("");
  const [nasUser, setNasUser] = useState("");
  const [nasPassword, setNasPassword] = useState("");
  const [accountError, setAccountError] = useState("");
  const [accountNotice, setAccountNotice] = useState("");
  useEffect(() => {
    let active = true;
    void window.electron
      .krystaCloudAccountStatus()
      .then((value) => {
        if (active) setAccounts(value);
      })
      .catch((e) => {
        if (active) setAccountError(String(e));
      });
    return () => {
      active = false;
    };
  }, []);
  const accountAction = async (
    fn: () => Promise<boolean>,
    successLabel?: string
  ) => {
    setBusy(true);
    setAccountError("");
    setAccountNotice("");
    try {
      const success = await fn();
      setAccounts(await window.electron.krystaCloudAccountStatus());
      if (success && successLabel) setAccountNotice(successLabel);
    } catch (e) {
      setAccountError(String(e));
    } finally {
      setNasPassword("");
      setBusy(false);
    }
  };

  useEffect(() => {
    let active = true;
    void window.electron
      .krystaCloudConfig()
      .then((c) => {
        if (active) setCfg(c);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const run = async (
    fn: () => Promise<{
      provider: string;
      folder?: string;
      autoBackup?: boolean;
      syncBeforeLaunch?: boolean;
    backupScreenshots?: boolean;
    backupRecordings?: boolean;
    }>
  ) => {
    setBusy(true);
    setError(false);
    try {
      setCfg(await fn());
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <h3>{pl ? "Centrum kopii zapasowych" : "Backup center"}</h3>
        <div style={{border:"1px solid #555",borderRadius:6,padding:12,display:"flex",flexDirection:"column",gap:8}}>
          <strong>{pl ? "Stan konfiguracji" : "Configuration status"}</strong>
          <p>{pl ? "Dostawca" : "Provider"}: {cfg?.provider === "google" ? "Google Drive" : cfg?.provider === "synology" ? "Synology Drive" : cfg?.provider === "local" ? (pl ? "Folder lokalny" : "Local folder") : cfg?.provider === "hydra" ? "Hydra Cloud" : "…"}</p>
          <p>{pl ? "Konfiguracja dostępu" : "Access configuration"}: {!cfg || ((cfg.provider==="google" || cfg.provider==="synology") && !accounts) ? (pl ? "Sprawdzanie…" : "Checking…") : cfg.provider==="hydra" ? (pl ? "Zarządzana przez Hydra" : "Managed by Hydra") : (cfg.provider==="google" ? accounts?.google : cfg.provider==="synology" ? accounts?.synology : !!cfg.folder) ? (pl ? "Skonfigurowana (nie oznacza testu połączenia)" : "Configured (not a connection test)") : (pl ? "Wymaga konfiguracji" : "Setup required")}</p>
          <p>{pl ? "Automatyczne kopie po grze" : "Automatic backups after play"}: {cfg?.provider==="hydra" || !cfg ? "—" : cfg.autoBackup ? (pl ? "Włączone" : "Enabled") : (pl ? "Wyłączone" : "Disabled")}</p>
          <p>{pl ? "Synchronizacja przed grą" : "Sync before play"}: {cfg?.provider==="google" || cfg?.provider==="synology" ? cfg.syncBeforeLaunch ? (pl ? "Włączona" : "Enabled") : (pl ? "Wyłączona" : "Disabled") : "—"}</p>
          <p>{pl ? "Zdjęcia / nagrania" : "Screenshots / recordings"}: {cfg?.provider==="google" ? [cfg.backupScreenshots,cfg.backupRecordings].map(v=>v?(pl?"Włączone":"Enabled"):(pl?"Wyłączone":"Disabled")).join(" / ") : "—"}</p>
          <Button theme="outline" disabled={busy} onClick={()=>{setBusy(true);setAccountError("");setError(false);void Promise.all([window.electron.krystaCloudConfig(),window.electron.krystaCloudAccountStatus()]).then(([c,a])=>{setCfg(c);setAccounts(a);}).catch(()=>setError(true)).finally(()=>setBusy(false));}}>{pl ? "Odśwież stan konfiguracji" : "Refresh configuration status"}</Button>
          <p>{pl ? "Historię wersji, ręczną synchronizację i przywracanie znajdziesz w menu Chmura wybranej gry. Stan konfiguracji nie potwierdza wykonania kopii." : "Version history, manual sync and restore are available in each game's Cloud menu. Configuration status does not confirm backup completion."}</p>
        </div>
        <h3>{pl ? "Dostawca chmury" : "Cloud provider"}</h3>
        <select
          aria-label={pl ? "Dostawca chmury" : "Cloud provider"}
          value={cfg?.provider ?? "hydra"}
          disabled={!cfg || busy}
          onChange={(e) => {
            const value = e.target.value;
            void run(() => window.electron.krystaCloudProvider(value));
          }}
          style={{
            background: "#202020",
            color: "inherit",
            padding: 10,
            border: "1px solid #555",
            borderRadius: 4,
          }}
        >
          <option value="hydra">Hydra Cloud</option>
          <option value="google">Google Drive</option>
          <option value="synology">Synology Drive</option>
          <option value="local">
            {pl ? "Folder lokalny lub sieciowy" : "Local or network folder"}
          </option>
        </select>
        {cfg?.provider === "hydra" ? (
          <p>
            {pl
              ? "Oryginalna usługa Hydra Cloud działa na dotychczasowych zasadach."
              : "Original Hydra Cloud maintains its existing rules."}
          </p>
        ) : (
          <>
            {cfg?.provider === "local" ? (
              <>
                {" "}
                <p>
                  {pl
                    ? "Wybierz folder kopii lokalnych."
                    : "Choose a local backup folder."}
                </p>
                <p style={{ overflowWrap: "anywhere" }}>
                  {cfg?.folder ??
                    (pl ? "Nie wybrano folderu" : "No folder selected")}
                </p>
                <Button
                  theme="outline"
                  disabled={busy || !cfg}
                  onClick={() =>
                    void run(() => window.electron.krystaCloudFolder())
                  }
                >
                  {pl ? "Wybierz folder" : "Choose folder"}
                </Button>
              </>
            ) : (
              <p>
                {pl
                  ? "Zapisy wykryte przez Ludusavi są przesyłane bezpośrednio na konto. Nie wybierasz folderu lokalnego."
                  : "Ludusavi-detected saves are uploaded directly to your account. No local folder selection is required."}
              </p>
            )}
            <CheckboxField
              checked={cfg?.autoBackup === true}
              disabled={
                busy ||
                !(cfg?.provider === "local"
                  ? cfg.folder
                  : cfg?.provider === "google"
                    ? accounts?.google
                    : accounts?.synology)
              }
              label={
                pl
                  ? "Automatyczna kopia po zakończeniu gry"
                  : "Automatically back up after exiting a game"
              }
              onChange={() =>
                void run(() =>
                  window.electron.krystaCloudAuto(!cfg?.autoBackup)
                )
              }
            />
            {(cfg?.provider === "google" || cfg?.provider === "synology") && (
              <>
                <CheckboxField
                  checked={cfg.syncBeforeLaunch === true}
                  disabled={
                    busy ||
                    !(cfg.provider === "google"
                      ? accounts?.google
                      : accounts?.synology)
                  }
                  label={
                    pl
                      ? "Synchronizuj zapisy przed uruchomieniem gry"
                      : "Sync saves before launching a game"
                  }
                  onChange={() =>
                    void run(() =>
                      window.electron.krystaCloudSyncBeforeLaunch(
                        !cfg.syncBeforeLaunch
                      )
                    )
                  }
                />
                <p>
                  {pl
                    ? "Krysta sprawdzi najnowszą kopię w chmurze. Jeśli zapisy się różnią, wybierzesz wersję przed startem gry."
                    : "Krysta checks the latest cloud backup. If saves differ, choose which version to use before launching."}
                </p>
              </>
            )}
            <p>
              {pl
                ? "Kopia jest tworzona 15 sekund po wykryciu zakończenia gry. Krysta przesyła kopię bezpośrednio przy połączonym koncie. Przywracanie wymaga zgodnych, wykrytych ścieżek zapisów."
                : "A backup is created 15 seconds after a tracked game ends. Krysta uploads directly for connected accounts. Restoring requires matching detected save paths."}
            </p>
          </>
        )}
        {(cfg?.provider === "google" || cfg?.provider === "synology") && (
          <>
            <h3>{pl ? "Połączenia z chmurą" : "Cloud connections"}</h3>
            <p>
              {pl
                ? "Połącz wybranego dostawcę. Kopie z tego komputera są przesyłane bezpośrednio; lokalna historia pozostaje dostępna."
                : "Connect your provider. Backups from this computer upload directly; local history remains available."}
            </p>
            {cfg.provider === "google" && (
              <>
                <h4>Google Drive</h4>
                <CheckboxField checked={cfg.backupScreenshots === true} disabled={busy || !accounts?.google} label={pl ? "Synchronizuj zrzuty ekranu" : "Back up screenshots"} onChange={() => void run(() => window.electron.krystaCloudMedia("backupScreenshots", !cfg.backupScreenshots))} />
                <CheckboxField checked={cfg.backupRecordings === true} disabled={busy || !accounts?.google} label={pl ? "Synchronizuj nagrania" : "Back up recordings"} onChange={() => void run(() => window.electron.krystaCloudMedia("backupRecordings", !cfg.backupRecordings))} />
                <p>{pl ? "Wymaga automatycznej kopii po grze. Limity pliku: zdjęcia 16 MB, nagrania 96 MB." : "Requires automatic backup after playing. File limits: screenshots 16 MB, recordings 96 MB."}</p>
                {accounts && !accounts.google && !accounts.googleConfigured && (
                  <p role="status">
                    {pl
                      ? "Brak skonfigurowanego klienta Google. Przy pierwszym połączeniu Krysta poprosi o plik JSON aplikacji Desktop z Google Cloud. Przy kolejnych logowaniach konfiguracja pozostanie zapisana lokalnie."
                      : "No Google client is configured. On first connect, Krysta will ask for a Desktop OAuth JSON from Google Cloud. The configuration is saved locally for future logins."}
                  </p>
                )}
                <p>
                  {pl
                    ? "Zaloguj się do Google w przeglądarce i zezwól Krystie na zapisywanie kopii gier."
                    : "Sign in to Google in your browser and allow Krysta to store game backups."}
                </p>
                <Button
                  theme="outline"
                  disabled={busy || !accounts}
                  onClick={() =>
                    void accountAction(() =>
                      accounts?.google
                        ? window.electron.krystaCloudAccountDisconnect("google")
                        : window.electron.krystaCloudGoogleConnect()
                    )
                  }
                >
                  {accounts?.google
                    ? pl
                      ? "Odłącz Google Drive"
                      : "Disconnect Google Drive"
                    : pl
                      ? "Połącz konto Google"
                      : "Connect Google account"}
                </Button>
                {accounts?.google && (
                  <Button
                    theme="outline"
                    disabled={busy}
                    onClick={() =>
                      void accountAction(
                        () => window.electron.krystaCloudGoogleTest(),
                        pl
                          ? "Google Drive: połączenie działa."
                          : "Google Drive connection is working."
                      )
                    }
                  >
                    {pl
                      ? "Sprawdź połączenie Google"
                      : "Test Google connection"}
                  </Button>
                )}
                {!accounts?.google && (
                  <details>
                    <summary>
                      {pl
                        ? "Opcje zaawansowane Google OAuth"
                        : "Advanced Google OAuth options"}
                    </summary>
                    <div className="settings-context-panel__group">
                      <Button
                        theme="outline"
                        disabled={busy || !accounts}
                        onClick={() =>
                          void accountAction(() =>
                            window.electron.krystaCloudGoogleConnectJson()
                          )
                        }
                      >
                        {pl
                          ? "Użyj innego pliku klienta Desktop JSON"
                          : "Use another Desktop OAuth JSON"}
                      </Button>
                      <p>
                        {pl
                          ? "Jeżeli Google zgłasza błąd 401 invalid_client, sprawdź konfigurację w Google Cloud i wybierz właściwy JSON klienta Desktop. Plik oraz token pozostają zaszyfrowane na tym komputerze."
                          : "If Google returns 401 invalid_client, check Google Cloud configuration and choose the matching Desktop OAuth JSON. Credentials remain encrypted on this computer."}
                      </p>
                    </div>
                  </details>
                )}
              </>
            )}
            {cfg.provider === "synology" && (
              <>
                <h4>Synology NAS (WebDAV HTTPS)</h4>
                {accounts?.synology ? (
                  <Button
                    theme="outline"
                    disabled={busy}
                    onClick={() =>
                      void accountAction(() =>
                        window.electron.krystaCloudAccountDisconnect("synology")
                      )
                    }
                  >
                    {pl ? "Odłącz Synology" : "Disconnect Synology"}
                  </Button>
                ) : (
                  <>
                    <input
                      aria-label="WebDAV HTTPS URL"
                      placeholder="https://nas.example.org:5006/Backups/"
                      value={nasUrl}
                      onChange={(e) => setNasUrl(e.target.value)}
                      disabled={busy}
                      style={{
                        background: "#202020",
                        color: "inherit",
                        padding: 10,
                        border: "1px solid #555",
                        borderRadius: 6,
                      }}
                    />
                    <input
                      aria-label={pl ? "Nazwa użytkownika" : "Username"}
                      autoComplete="username"
                      placeholder={pl ? "Nazwa użytkownika" : "Username"}
                      value={nasUser}
                      onChange={(e) => setNasUser(e.target.value)}
                      disabled={busy}
                      style={{
                        background: "#202020",
                        color: "inherit",
                        padding: 10,
                        border: "1px solid #555",
                        borderRadius: 6,
                      }}
                    />
                    <input
                      type="password"
                      aria-label={pl ? "Hasło" : "Password"}
                      autoComplete="current-password"
                      placeholder={pl ? "Hasło" : "Password"}
                      value={nasPassword}
                      onChange={(e) => setNasPassword(e.target.value)}
                      disabled={busy}
                      style={{
                        background: "#202020",
                        color: "inherit",
                        padding: 10,
                        border: "1px solid #555",
                        borderRadius: 6,
                      }}
                    />
                    <Button
                      theme="outline"
                      disabled={
                        busy || !accounts || !nasUrl || !nasUser || !nasPassword
                      }
                      onClick={() =>
                        void accountAction(() =>
                          window.electron.krystaCloudSynologyConnect(
                            nasUrl,
                            nasUser,
                            nasPassword
                          )
                        )
                      }
                    >
                      {pl
                        ? "Połącz i sprawdź dostęp"
                        : "Connect and test access"}
                    </Button>
                  </>
                )}
              </>
            )}
          </>
        )}
        <h3>
          {pl
            ? "Lokalne kopie przed aktualizacjami"
            : "Local pre-update backups"}
        </h3>
        <p>
          {pl
            ? "Kopie przed aktualizacją gry są zapisywane na tym komputerze niezależnie od połączenia Google Drive lub Synology."
            : "Pre-update game save backups are stored on this computer independently of Google Drive or Synology."}
        </p>
        <Button
          theme="outline"
          disabled={busy}
          onClick={() => {
            setAccountError("");
            void window.electron
              .krystaCloudOpenPreUpdateFolder()
              .catch((e) => setAccountError(String(e)));
          }}
        >
          {pl ? "Otwórz folder kopii lokalnych" : "Open local backup folder"}
        </Button>
        {accountNotice && <p role="status">{accountNotice}</p>}
        {accountError && <p role="alert">{accountError}</p>}
        {error && (
          <p role="alert">
            {pl
              ? "Nie udało się zapisać ustawień."
              : "Unable to save settings."}
          </p>
        )}
      </div>
    </div>
  );
}
