import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Trophy } from "lucide-react";
import "./krysta-game-updates.scss";

type Account = Awaited<ReturnType<typeof window.electron.getRockstarAccount>>;
type Awards = Awaited<ReturnType<typeof window.electron.getRockstarAccountAwards>>;

/**
 * Rockstar achievements are an independent, read-only account source.
 * Never decorate a Steam/Epic unlock with Rockstar achievement state.
 */
export function KrystaRockstarAchievements({ gameId }: { gameId: string }) {
  const pl = document.documentElement.lang.startsWith("pl");
  const [account, setAccount] = useState<Account | null>(null);
  const [snapshot, setSnapshot] = useState<Awards | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refreshAccount = useCallback(async () => {
    setAccount(await window.electron.getRockstarAccount());
  }, []);
  useEffect(() => {
    let alive = true;
    void window.electron.getRockstarAccount().then((state) => {
      if (alive) setAccount(state);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const sync = async () => {
    setBusy(true);
    setError("");
    try {
      await refreshAccount();
      const result = await window.electron.getRockstarAccountAwards(gameId);
      setSnapshot(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="krysta-updates" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <header className="krysta-updates__header">
        <h2><Trophy size={18} /> {pl ? "Osiągnięcia Rockstar Social Club" : "Rockstar Social Club achievements"}</h2>
        <button disabled={busy} onClick={() => void sync()}>
          <RefreshCw size={14} /> {pl ? "Synchronizuj" : "Sync"}
        </button>
      </header>
      {account?.connected
        ? <p>{pl ? "Połączone konto" : "Connected account"}: {account.username}</p>
        : <p>{pl
          ? "Połącz konto Rockstar w Ustawieniach → Integracje, a następnie wróć tutaj."
          : "Connect your Rockstar account in Settings → Integrations, then return here."}</p>}
      {busy && <p role="status">{pl ? "Pobieranie osiągnięć…" : "Fetching achievements…"}</p>}
      {error && <p role="alert">{error}</p>}
      {snapshot && (
        <>
          <p><strong>{snapshot.awards.length}</strong> {pl ? "potwierdzonych osiągnięć" : "confirmed unlocks"}</p>
          <small>{pl ? "Ostatni odczyt" : "Last sync"}: {new Date(snapshot.updatedAt).toLocaleString()}</small>
          <ul>
            {snapshot.awards.map((item) => (
              <li key={item.id}>
                {pl ? "Osiągnięcie Rockstar" : "Rockstar achievement"} #{item.id}
                {item.unlockTime ? ` · ${new Date(item.unlockTime).toLocaleString()}` : ""}
              </li>
            ))}
          </ul>
          <small>{pl
            ? "Rockstar zwraca numery odblokowań. Dopasowanie opisów i ikon do lokalnych danych gry będzie wymagało osobnego odczytu katalogu osiągnięć."
            : "Rockstar returns numeric unlock IDs. Local achievement catalogue matching is required for names and icons."}</small>
        </>
      )}
      <small>{pl
        ? "Tylko odczyt z konta Rockstar. Nie zmienia osiągnięć Steam ani Epic."
        : "Read-only Rockstar account achievements. Steam and Epic remain unchanged."}</small>
    </section>
  );
}
