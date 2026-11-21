import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SyncIcon, LinkExternalIcon } from "@primer/octicons-react";
import { Button } from "@renderer/components";
import { useLibrary } from "@renderer/hooks";
import {
  SettingsIntegrationCard,
  SettingsIntegrationLastSynced,
} from "./settings-integration-card";
export function SettingsRockstar() {
  const { i18n } = useTranslation("settings");
  const pl = i18n.language.startsWith("pl");
  const { updateLibrary } = useLibrary();
  const [state, setState] = useState<Awaited<
    ReturnType<typeof window.electron.scanRockstar>
  > | null>(null);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    void window.electron
      .scanRockstar()
      .then((v) => {
        if (active) setState(v);
      })
      .catch(() => {
        if (active)
          setNotice(
            pl
              ? "Nie udało się wykryć launchera Rockstar."
              : "Rockstar discovery failed."
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [pl]);
  const run = async (action: "sync" | "open" | "chooseLauncher" | "chooseGame") => {
    setBusy(true);
    setNotice("");
    try {
      if (action === "open") {
        await window.electron.openRockstarLauncher();
        return;
      }
      if (action === "chooseLauncher" || action === "chooseGame") {
        const chosen = await (action === "chooseLauncher"
          ? window.electron.selectRockstarLauncherFolder()
          : window.electron.selectRockstarGameFolder());
        if (!chosen) return;
        setState(chosen);
        setNotice(
          pl
            ? `Wykryto gier: ${chosen.games.length}. Kliknij Synchronizuj, aby dodać je do biblioteki.`
            : `Detected games: ${chosen.games.length}. Click Sync to add them to the library.`
        );
        return;
      }
      const scan = await window.electron.scanRockstar();
      setState(scan);
      if (!scan.installed && scan.games.length === 0) {
        setNotice(
          pl
            ? "Zainstaluj oficjalny Rockstar Games Launcher."
            : "Install the official Rockstar Games Launcher."
        );
        return;
      }
      const r = await window.electron.importRockstar();
      setState({ ...scan, lastSync: r.lastSync });
      await updateLibrary();
      setNotice(
        pl
          ? `Dodano: ${r.added}, powiązano: ${r.linked}, istniejące: ${r.existing}, pominięto: ${r.skipped}.`
          : `Added: ${r.added}, linked: ${r.linked}, existing: ${r.existing}, skipped: ${r.skipped}.`
      );
    } catch (e) {
      setNotice(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsIntegrationCard
      title="Rockstar Games Launcher"
      logo={<span style={{ fontWeight: "bold", color: "#ffab00" }}>R★</span>}
      loading={loading}
      status={
        state?.installed || (state?.games.length ?? 0) > 0
          ? pl
            ? "Wykryto"
            : "Detected"
          : state?.supported === false
            ? pl
              ? "Tylko Windows"
              : "Windows only"
            : pl
              ? "Nie wykryto"
              : "Not detected"
      }
      statusTone={state?.installed || (state?.games.length ?? 0) > 0 ? "success" : "neutral"}
      actions={
        <>
          <Button
            theme="outline"
            disabled={busy || state?.supported === false}
            onClick={() => void run("sync")}
          >
            <SyncIcon size={14} />
            {pl ? "Synchronizuj" : "Sync"}
          </Button>
          <Button
            theme="outline"
            disabled={busy || state?.supported === false}
            onClick={() => void run("chooseLauncher")}
          >
            {pl ? "Wskaż launcher" : "Locate launcher"}
          </Button>
          <Button
            theme="outline"
            disabled={busy || state?.supported === false}
            onClick={() => void run("chooseGame")}
          >
            {pl ? "Dodaj folder gry" : "Add game folder"}
          </Button>
          <Button
            theme="outline"
            disabled={busy || !state?.installed}
            onClick={() => void run("open")}
          >
            <LinkExternalIcon size={14} />
            {pl ? "Otwórz" : "Open"}
          </Button>
        </>
      }
    >
      <p>
        {pl
          ? "Import lokalnie zainstalowanych gier. Jeśli Krysta nie widzi launchera lub gry, wskaż ich foldery ręcznie. Gry ze Steam i Epic importuj przez odpowiednie integracje."
          : "Import locally installed games. If Krysta cannot detect the launcher or a game, select its folder manually. Import Steam and Epic games through their own integrations."}
      </p>
      {(state?.installed || (state?.games.length ?? 0) > 0) && (
        <>
          <p>
            {pl ? "Wykryte gry" : "Detected games"}: {state.games.length}
          </p>
          <SettingsIntegrationLastSynced lastSyncedAt={state.lastSync} />
        </>
      )}
      {notice && <p role="status">{notice}</p>}
    </SettingsIntegrationCard>
  );
}
