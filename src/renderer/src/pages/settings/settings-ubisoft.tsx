import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LinkExternalIcon, SyncIcon, PersonIcon } from "@primer/octicons-react";
import { useLibrary } from "@renderer/hooks";
import { Button } from "@renderer/components";
import {
  SettingsIntegrationCard,
  SettingsIntegrationLastSynced,
} from "./settings-integration-card";

export function SettingsUbisoft() {
  const { i18n } = useTranslation("settings");
  const pl = i18n.language.startsWith("pl");
  const { updateLibrary } = useLibrary();
  const [state, setState] = useState<Awaited<
    ReturnType<typeof window.electron.getUbisoftAccount>
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void window.electron
      .getUbisoftAccount()
      .then((value) => {
        if (active) setState(value);
      })
      .catch(() => {
        if (active)
          setNotice(
            pl
              ? "Nie udało się odczytać statusu konta."
              : "Could not read account status."
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [pl]);
  const run = async (action: "connect" | "sync" | "disconnect") => {
    setBusy(true);
    setNotice("");
    try {
      const result = await (action === "connect"
        ? window.electron.connectUbisoftAccount()
        : action === "sync"
          ? window.electron.syncUbisoftAccount()
          : window.electron.disconnectUbisoftAccount());
      setState(result);
      await updateLibrary();
      if (action !== "disconnect")
        setNotice(
          pl
            ? "Gry na koncie: " + result.games.length
            : "Games on account: " + result.games.length
        );
    } catch {
      setNotice(
        pl
          ? "Operacja nie powiodła się. Spróbuj ponownie po zalogowaniu."
          : "Operation failed. Try signing in again."
      );
      try {
        setState(await window.electron.getUbisoftAccount());
      } catch {
        /* keep status */
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsIntegrationCard
      title="Ubisoft Connect"
      logo={
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M4 8c9-10 21 3 11 10-6 4-13-4-7-8 4-3 9 2 5 5" />
        </svg>
      }
      loading={loading}
      status={
        state?.connected
          ? pl
            ? "Połączono"
            : "Connected"
          : pl
            ? "Niepołączono"
            : "Not connected"
      }
      statusTone={state?.connected ? "success" : "neutral"}
      actions={
        state?.connected ? (
          <>
            <Button
              theme="outline"
              disabled={busy}
              onClick={() => void run("sync")}
            >
              <SyncIcon size={14} />
              {pl ? "Synchronizuj" : "Sync"}
            </Button>
            <Button
              theme="danger"
              disabled={busy}
              onClick={() => void run("disconnect")}
            >
              {pl ? "Rozłącz" : "Disconnect"}
            </Button>
          </>
        ) : (
          <Button disabled={busy} onClick={() => void run("connect")}>
            <LinkExternalIcon size={14} />
            {pl ? "Połącz konto" : "Connect account"}
          </Button>
        )
      }
    >
      {state?.connected ? (
        <div className="settings-integration-card__profile">
          <div className="settings-integration-card__avatar">
            <PersonIcon size={28} />
          </div>
          <div className="settings-integration-card__account">
            <span className="settings-integration-card__username">
              {state.username}
            </span>
            <SettingsIntegrationLastSynced lastSyncedAt={state.lastSync} />
          </div>
        </div>
      ) : (
        <p className="settings-integration-card__description">
          {pl
            ? "Połącz konto Ubisoft, aby pobrać bibliotekę gier i odczytywać własne osiągnięcia."
            : "Connect your Ubisoft account to retrieve owned games and read your achievements."}
        </p>
      )}
      <small>
        {pl
          ? "Osiągnięcia Ubisoft są odczytywane w szczegółach gry z niepublicznego interfejsu Ubisoft Connect. Funkcja może przestać działać po zmianach usługi; nie modyfikuje osiągnięć."
          : "Ubisoft achievements are read in game details using a non-public Ubisoft Connect interface. Service changes may break this feature; it never modifies achievements."}
      </small>
      <small>
        {pl
          ? "Jeśli włączysz nagrywanie osiągnięć w ustawieniach zrzutów ekranu, Krysta podczas aktywnej rozgrywki sprawdza osiągnięcia Ubisoft co około 10 sekund. Pierwszy odczyt nie zapisuje klipów."
          : "When achievement recording is enabled in screenshot settings, Krysta checks Ubisoft achievements roughly every 10 seconds during active gameplay. The first read does not save clips."}
      </small>
      {busy && <p role="status">{pl ? "Trwa operacja..." : "Working..."}</p>}
      {notice && <p role="status">{notice}</p>}
    </SettingsIntegrationCard>
  );
}
