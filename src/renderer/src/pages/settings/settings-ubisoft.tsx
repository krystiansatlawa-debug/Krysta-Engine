import { useEffect, useState } from "react";
import { SettingsIntegrationCard } from "./settings-integration-card";

export function SettingsUbisoft() {
  const [data, setData] = useState<Awaited<ReturnType<typeof window.electron.scanUbisoft>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pl = document.documentElement.lang.startsWith("pl");
  const refresh = async () => {
    setBusy(true); setError("");
    try { setData(await window.electron.scanUbisoft()); }
    catch { setError(pl ? "Nie udało się wykryć gier." : "Game detection failed."); }
    finally { setBusy(false); }
  };
  useEffect(() => { void refresh(); }, []);
  return <SettingsIntegrationCard title="Ubisoft Connect"
    logo={<span aria-hidden="true" style={{fontWeight:800,fontSize:22}}>U</span>}
    status={data?.installed ? (pl ? "Wykryto klienta" : "Client detected") : (pl ? "Nie wykryto klienta" : "Client not detected")}
    statusTone={data?.installed ? "success" : "neutral"}
    actions={<button type="button" disabled={busy} onClick={() => void refresh()}>{pl ? "Odśwież gry" : "Refresh games"}</button>}>
    <p>{pl ? "Gry zainstalowane lokalnie. Logowanie odbywa się w Ubisoft Connect." : "Locally installed games. Sign in using Ubisoft Connect."}</p>
    {busy && <p>{pl ? "Skanowanie..." : "Scanning..."}</p>}
    {error && <p role="alert">{error}</p>}
    {data && !data.supported && <p>Windows only</p>}
    {data?.supported && !busy && data.games.length===0 && <p>{pl ? "Nie znaleziono zainstalowanych gier." : "No installed games found."}</p>}
    {data?.games.map(game => <div key={game.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,padding:"8px 0"}}><span>{game.title}</span><button type="button" disabled={!data.installed} onClick={async()=>{setError("");try{await window.electron.launchUbisoft(game.id);}catch{setError(pl?"Nie udało się uruchomić gry.":"Could not launch game.");}}}>{pl?"Graj":"Play"}</button></div>)}
    <a href="https://ubisoftconnect.com/" target="_blank" rel="noreferrer">Ubisoft Connect</a>
  </SettingsIntegrationCard>;
}
