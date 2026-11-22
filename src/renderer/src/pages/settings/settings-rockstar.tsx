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
  const [account, setAccount] = useState<{connected: boolean; username: string | null} | null>(null);
  const [awards, setAwards] = useState<Awaited<ReturnType<typeof window.electron.getRockstarAccountAwards>> | null>(null);
  const [selectedGame, setSelectedGame] = useState("gtav-legacy");
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountMessage, setAccountMessage] = useState("");
  const refreshAccount = async () => {
    setAccount(await window.electron.getRockstarAccount());
  };
  const accountAction = async (action: "connect" | "refresh" | "disconnect" | "sync") => {
    if (accountBusy) return;
    setAccountBusy(true);
    setAccountMessage("");
    try {
      if (action === "connect") {
        await window.electron.connectRockstarAccount();
        setAccountMessage(pl
          ? "Zaloguj się w oknie Rockstar, zamknij je, a następnie kliknij Sprawdź połączenie."
          : "Sign in in the Rockstar window, close it, then click Check connection.");
      } else if (action === "disconnect") {
        await window.electron.disconnectRockstarAccount();
        setAwards(null);
        await refreshAccount();
      } else if (action === "sync") {
        const result = await window.electron.getRockstarAccountAwards(selectedGame);
        setAwards(result);
        setAccountMessage(pl
          ? `Pobrano ${result.awards.length} potwierdzonych osiągnięć.`
          : `Fetched ${result.awards.length} verified unlocks.`);
      } else {
        await refreshAccount();
      }
    } catch (error) {
      setAccountMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAccountBusy(false);
    }
  };
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    void window.electron.getRockstarAccount().then((value) => {
      if (active) setAccount(value);
    }).catch(() => {});
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
            {pl ? "Wykryte gry" : "Detected games"}: {state?.games.length ?? 0}
          </p>
          <SettingsIntegrationLastSynced lastSyncedAt={state?.lastSync ?? null} />
        </>
      )}
      {state?.achievements && (
        <p>
          {pl
            ? `Social Club: wykryte profile lokalne: ${state.achievements.profileCount}, foldery danych gier: ${state.achievements.titleDirectories}. Odczyt zdobytych osiągnięć wymaga osobnego połączenia konta Rockstar; nie jest jeszcze dostępny.`
            : `Social Club: local profiles: ${state.achievements.profileCount}, game data folders: ${state.achievements.titleDirectories}. Unlocked achievement synchronization requires a separate Rockstar account connection and is not available yet.`}
        </p>
      )}
      <section style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
        <h3>{pl ? "Osiągnięcia Rockstar Social Club" : "Rockstar Social Club achievements"}</h3>
        <p>{account?.connected
          ? (pl ? `Połączono: ${account.username || "Rockstar Games"}` : `Connected: ${account.username || "Rockstar Games"}`)
          : (pl ? "Konto niepołączone — zaloguj się przez oficjalną stronę Rockstar."
            : "Account not connected — use the official Rockstar sign-in.")}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <Button theme="outline" disabled={accountBusy} onClick={() => void accountAction("connect")}>
            {pl ? "Połącz konto Rockstar" : "Connect Rockstar account"}
          </Button>
          <Button theme="outline" disabled={accountBusy} onClick={() => void accountAction("refresh")}>
            {pl ? "Sprawdź połączenie" : "Check connection"}
          </Button>
          <Button theme="outline" disabled={accountBusy || !account?.connected} onClick={() => void accountAction("disconnect")}>
            {pl ? "Rozłącz konto" : "Disconnect"}
          </Button>
        </div>
        {account?.connected && (
          <>
            <label htmlFor="rockstar-achievement-title">{pl ? "Gra Rockstar" : "Rockstar game"}</label>
            <select id="rockstar-achievement-title" value={selectedGame} onChange={(e) => {
              setSelectedGame(e.target.value);
              setAwards(null);
            }}>
              <option value="gtav-legacy">Grand Theft Auto V</option>
              <option value="gtav-enhanced">Grand Theft Auto V Enhanced</option>
              <option value="rdr2">Red Dead Redemption 2</option>
              <option value="gtaiv">Grand Theft Auto IV</option>
              <option value="maxpayne3">Max Payne 3</option>
              <option value="lanoire">L.A. Noire</option>
            </select>
            <Button theme="outline" disabled={accountBusy} onClick={() => void accountAction("sync")}>
              {pl ? "Pobierz osiągnięcia" : "Fetch achievements"}
            </Button>
          </>
        )}
        {awards && (
          <div>
            <strong>{pl ? "Potwierdzone osiągnięcia" : "Confirmed unlocks"}: {awards.awards.length}</strong>
            <small style={{ display: "block" }}>
              {pl ? "Rockstar zwraca identyfikatory osiągnięć. Nazwy i ikony wymagają lokalnego katalogu gry."
                : "Rockstar returns achievement IDs. Names and icons require the local game catalogue."}
            </small>
            <ul>
              {awards.awards.slice(0, 150).map((award) => (
                <li key={award.id}>
                  {pl ? "Osiągnięcie" : "Achievement"} #{award.id}
                  {award.unlockTime ? ` · ${new Date(award.unlockTime).toLocaleString(i18n.language)}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
        {accountMessage && <p role="status">{accountMessage}</p>}
        <small>{pl
          ? "Odczyt tylko do podglądu: nie odblokowuje osiągnięć Steam ani Epic. Korzysta z nieoficjalnie udokumentowanego interfejsu Rockstar; może wymagać ponownego logowania."
          : "Read-only: does not unlock Steam or Epic achievements. The Rockstar interface is undocumented and may require reauthentication."}</small>
      </section>
      {notice && <p role="status">{notice}</p>}
    </SettingsIntegrationCard>
  );
}
