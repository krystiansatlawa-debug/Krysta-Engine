import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components";
type Info = Awaited<ReturnType<typeof window.electron.krystaUpdatesCheck>>;
export function SettingsContextKrystaUpdates() {
  const { i18n } = useTranslation();
  const pl = i18n.language.startsWith("pl");
  const [info, setInfo] = useState<Info | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [prefs, setPrefs] = useState<{
    automatic: boolean;
    notifications: boolean;
  } | null>(null);
  const [notes, setNotes] = useState(false);
  const [download, setDownload] = useState<Awaited<
    ReturnType<typeof window.electron.krystaUpdatesStatus>
  > | null>(null);
  const [installing, setInstalling] = useState(false);
  const [sync, setSync] = useState<Awaited<
    ReturnType<typeof window.electron.krystaUpdatesSyncStatus>
  > | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const refreshSync = async () => {
    setSyncBusy(true);
    try {
      setSync(await window.electron.krystaUpdatesSyncRefresh());
    } catch {
      setSync(null);
    } finally {
      setSyncBusy(false);
    }
  };
  useEffect(() => {
    let active = true;
    const poll = () => {
      if (document.hidden) return;
      void window.electron
        .krystaUpdatesSyncStatus()
        .then((v) => {
          if (active) setSync(v);
        })
        .catch(() => {});
    };
    poll();
    const timer = setInterval(poll, 60000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, []);
  const syncLabels = {
    integrated: pl
      ? "Numer wersji bazowej jest aktualny"
      : "Base version number is current",
    pending: pl
      ? "Nowa baza wykryta — oczekiwanie na integrację lub status"
      : "New upstream detected — awaiting integration or status",
    running: pl
      ? "Trwa integracja lub kompilacja testowa"
      : "Integration or test build running",
    review: pl
      ? "Proces zakończony — oczekiwanie na weryfikację i wydanie Krysty"
      : "Process completed — awaiting review and Krysta release",
    failed: pl ? "Integracja wymaga naprawy" : "Integration needs attention",
    unknown: pl
      ? "Status chwilowo niedostępny"
      : "Status temporarily unavailable",
  };
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let delay = 10000;
      try {
        const value = await window.electron.krystaUpdatesStatus();
        if (disposed) return;
        setDownload(value);
        delay = value.phase === "downloading" ? 1000 : 10000;
      } catch {
        // Preserve the last status and retry at the next poll.
      }
      if (!disposed) timer = setTimeout(poll, delay);
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, []);
  const install = async () => {
    setInstalling(true);
    setError("");
    try {
      await window.electron.krystaUpdatesInstall();
    } catch (e) {
      setError(String(e));
    } finally {
      setInstalling(false);
    }
  };
  const check = async () => {
    setBusy(true);
    setError("");
    try {
      setInfo(await window.electron.krystaUpdatesCheck());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void window.electron
      .krystaUpdatesPrefs()
      .then(setPrefs)
      .catch((e) => setError(String(e)));
    void check();
  }, []);
  const update = async (automatic: boolean, notifications: boolean) => {
    try {
      setPrefs(
        await window.electron.krystaUpdatesSet(automatic, notifications)
      );
    } catch (e) {
      setError(String(e));
    }
  };
  const open = (kind: "hydra" | "krysta" | "sync") =>
    void window.electron
      .krystaUpdatesOpen(kind)
      .catch((e) => setError(String(e)));
  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <h3>Krysta Launcher</h3>
        <p>
          {pl ? "Zainstalowana wersja" : "Installed version"}:{" "}
          {info?.version ?? "—"}
        </p>
        <p>
          {pl
            ? "Najnowsze opublikowane wydanie Krysty"
            : "Latest published Krysta release"}
          :{" "}
          {info
            ? (info.krysta?.tag ?? (pl ? "Brak wydania" : "No release"))
            : "—"}
        </p>
        <Button theme="outline" onClick={() => open("krysta")}>
          {pl
            ? "Wydania i instalatory Krysty"
            : "Krysta releases and installers"}
        </Button>
        {info?.krystaNew === true && (
          <p role="status">
            {pl
              ? "Dostępna nowa wersja Krysty."
              : "New Krysta release available."}
          </p>
        )}
        {download?.phase === "downloading" && (
          <div>
            <p>
              {pl ? "Pobieranie instalatora" : "Downloading installer"}:{" "}
              {download.total
                ? Math.floor((100 * download.received) / download.total)
                : 0}
              %
            </p>
            <progress max={download.total || 1} value={download.received} />
          </div>
        )}
        {download?.phase === "ready" && (
          <Button
            theme="outline"
            disabled={installing}
            onClick={() => void install()}
          >
            {pl
              ? "Zainstaluj pobraną aktualizację"
              : "Install downloaded update"}{" "}
            {download.version}
          </Button>
        )}
        {download?.phase === "error" && <p role="alert">{download.error}</p>}
        <Button theme="outline" disabled={busy} onClick={() => void check()}>
          {busy
            ? pl
              ? "Sprawdzanie…"
              : "Checking…"
            : pl
              ? "Sprawdź aktualizacje"
              : "Check for updates"}
        </Button>
        {info && (
          <p>
            {pl ? "Ostatnie sprawdzenie" : "Last checked"}:{" "}
            {new Date(info.checkedAt).toLocaleString(i18n.language)}
          </p>
        )}

        <label>
          <input
            type="checkbox"
            disabled={!prefs}
            checked={prefs?.automatic ?? false}
            onChange={(e) =>
              void update(e.target.checked, prefs?.notifications ?? true)
            }
          />{" "}
          {pl
            ? "Automatyczne sprawdzanie i pobieranie (Windows)"
            : "Automatic checks and downloads (Windows)"}
        </label>
        <label>
          <input
            type="checkbox"
            disabled={!prefs}
            checked={prefs?.notifications ?? false}
            onChange={(e) =>
              void update(prefs?.automatic ?? true, e.target.checked)
            }
          />{" "}
          {pl
            ? "Powiadomienia o nowych wersjach Krysty"
            : "New Krysta release notifications"}
        </label>
        <Button
          theme="outline"
          disabled={!info}
          onClick={() => setNotes(!notes)}
        >
          {pl ? "Historia zmian najnowszych wydań" : "Latest release notes"}
        </Button>
        {notes && info && (
          <>
            <h4>Krysta {info.krysta?.tag ?? ""}</h4>
            <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {info.krysta?.body ??
                (pl ? "Brak opublikowanego wydania." : "No published release.")}
            </p>
          </>
        )}
        <p>
          {pl
            ? "Instalator pobierany jest z repozytorium Krysty i sprawdzany sumą SHA-256. Instalacja wymaga kliknięcia. Wersja Portable korzysta z pobierania ręcznego."
            : "Krysta installers are downloaded from its repository and checked against SHA-256. Installation requires confirmation. Portable uses manual downloads."}
        </p>
        {error && <p role="alert">{error}</p>}
      </div>
      <div className="settings-context-panel__group">
        <h3>
          {pl ? "Synchronizacja z Hydrą" : "Hydra upstream synchronization"}
        </h3>
        <p>
          {pl
            ? "Krysta korzysta z poprawek Hydry po integracji i testach. Wersja Hydry nie zastępuje Krysty."
            : "Krysta incorporates Hydra fixes after integration and testing. Hydra never replaces Krysta."}
        </p>
        <p>
          {pl
            ? "Baza tej kompilacji (numer pakietu)"
            : "Build base (package version)"}
          : {sync?.base ?? "—"}
        </p>
        <p>
          {pl ? "Najnowsza stabilna baza" : "Latest stable upstream"}:{" "}
          {sync?.upstream ?? "—"}
        </p>
        <p role="status">
          {sync
            ? syncLabels[sync.phase]
            : pl
              ? "Sprawdzanie statusu…"
              : "Checking status…"}
        </p>
        {sync && (
          <p>
            {pl ? "Ostatnie sprawdzenie" : "Last checked"}:{" "}
            {new Date(sync.checkedAt).toLocaleString(i18n.language)}
          </p>
        )}
        <Button
          theme="outline"
          disabled={syncBusy}
          onClick={() => void refreshSync()}
        >
          {syncBusy
            ? pl
              ? "Sprawdzanie…"
              : "Checking…"
            : pl
              ? "Odśwież status synchronizacji"
              : "Refresh synchronization status"}
        </Button>
        <p>
          {pl
            ? "Integracja odbywa się automatycznie na serwerze GitHub. Gotowe wydanie Krysty zostanie wykryte przez aktualizator. Konflikty i publikacja wymagają weryfikacji projektu."
            : "Integration runs automatically on GitHub. The updater detects published Krysta builds. Conflicts and publishing require project review."}
        </p>
      </div>
    </div>
  );
}
