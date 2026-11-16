import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import "./krysta-game-updates.scss";
type Watch=Awaited<ReturnType<typeof window.electron.krystaGameWatchGet>>;
export function KrystaGameWatch({shop,id}:{shop:string;id:string}){
 const {i18n}=useTranslation();const pl=i18n.language.startsWith("pl");
 const [watch,setWatch]=useState<Watch>(null),[override,setOverride]=useState<"inherit"|"on"|"off">("inherit"),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");
 useEffect(()=>{let active=true;setReady(false);setNotice("");setWatch(null);
 void window.electron.krystaGameWatchGet(shop,id).then(w=>{if(active){setWatch(w);setOverride(w?.override??"inherit");setReady(true);}}).catch(e=>{if(active)setNotice(String(e));});
 return()=>{active=false;};},[shop,id]);
 const act=async(check:boolean)=>{setBusy(true);setNotice("");try{const w=await window.electron.krystaGameWatchSet(shop,id,override);setWatch(w);if(check)setWatch(await window.electron.krystaGameWatchCheck(shop,id));else setNotice(pl?"Zapisano ustawienia.":"Settings saved.");}catch(e){setNotice(String(e));}finally{setBusy(false);window.dispatchEvent(new Event("krysta:patch-badges"));}};
 const official=shop==="steam"||shop==="epic"||(shop==="custom"&&/^(ubi-owned-|ubisoft-)/.test(id));
 const prepareUpdate=async()=>{
  setBusy(true);setNotice("");
  try{
   const cfg=await window.electron.krystaCloudConfig();
   if(cfg.provider==="hydra"||(cfg.provider==="local"&&!cfg.folder)){
    setNotice(pl?"Najpierw skonfiguruj miejsce kopii w Ustawienia → Krysta Cloud.":"First configure a backup destination in Settings → Krysta Cloud.");
    return;
   }
   const saved=await window.electron.krystaCloudBackup(shop,id);
   if(!saved){setNotice(pl?"Anulowano kopię; Steam nie został otwarty przez Krystę.":"Backup cancelled; Krysta did not open Steam.");return;}
   setNotice(pl?"Kopia zapisana. Otwieranie Steam…":"Backup saved. Opening Steam…");
   await window.electron.krystaGameWatchOpenClient(shop,id);
   setNotice(pl?"Kopia zapisana; aktualizację wykonaj w Steam.":"Backup saved; complete the update in Steam.");
  }catch(e){setNotice(String(e));}
  finally{setBusy(false);}
 };
 return <section className="krysta-watch">
 <h3>{pl?"Monitor aktualizacji gry":"Game update monitor"}</h3>
 <label>{pl?"Monitorowanie tej gry":"Monitor this game"} <select value={override} disabled={!ready||busy} onChange={e=>setOverride(e.target.value as "inherit"|"on"|"off")} style={{background:"#202020",color:"inherit",padding:6,border:"1px solid #555",borderRadius:4}}><option value="inherit">{pl?"Ustawienia globalne":"Global settings"}</option><option value="on">{pl?"Zawsze włączone":"Always enabled"}</option><option value="off">{pl?"Wyłączone":"Disabled"}</option></select></label>
 <small>{watch?.enabled?(pl?"Monitorowanie aktywne":"Monitoring enabled"):(pl?"Monitorowanie nieaktywne":"Monitoring disabled")}</small>
 <div className="krysta-watch__versions"><div><small>{pl?"Zainstalowana wersja":"Installed version"}</small><strong>{watch?.installedVersion||(pl?"Nie wykryto":"Not detected")}</strong></div><div><small>Steam Build ID</small><strong>{watch?.steamBuildId??"—"}</strong></div><div><small>{pl?"Wersja ogłoszonego patcha":"Announced patch version"}</small><strong>{watch?.latestVersion??"—"}</strong></div></div>
 {watch?.versionSource&&<small>{pl?"Źródło: ":"Source: "}{watch.versionSource==="epic-manifest"?"Epic Games manifest":watch.versionSource==="version-file"?(pl?"Lokalny plik wersji":"Local version file"):watch.versionSource==="product"?"EXE ProductVersion":"EXE FileVersion"}</small>}
 <p>{pl?"Stan aktualizacji (Steam)":"Update state (Steam)"}: <strong>{watch?.updateState==="required"?(pl?"Aktualizacja wymagana":"Update required"):watch?.updateState==="not-reported"?(pl?"Steam nie zgłasza aktualizacji":"Steam reports no update"):(pl?"Niepotwierdzony":"Unconfirmed")}</strong></p>
 {ready&&!watch?.installedVersion&&<p className="krysta-watch__warning">{watch?.steamBuildId?(pl?"Instalacja Steam wykryta. Plik EXE nie udostępnia numeru wersji lub nie został wskazany.":"Steam installation detected. EXE version metadata is unavailable or the executable is not configured."):(pl?"Nie udało się odczytać lokalnej wersji. Sprawdź ścieżkę pliku uruchamiania gry w jej ustawieniach.":"Local version unavailable. Check the game executable path in game settings.")}</p>}
 {watch?.pendingPatch&&<div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}><strong>{pl?"Nowy patch":"New patch"}: {watch.pendingPatch}</strong><button type="button" disabled={busy} onClick={()=>{void window.electron.krystaGameWatchDismiss(shop,id).then(()=>{setWatch(w=>w?{...w,pendingPatch:undefined}:w);window.dispatchEvent(new Event("krysta:patch-badges"));}).catch(e=>setNotice(String(e)));}}>{pl?"Oznacz jako przeczytany":"Mark as read"}</button></div>}
 {watch?.latestTitle&&<p>{watch.latestTitle}</p>}
 <details>
 <summary>{pl?"Historia wykrytych zmian wersji Steam":"Detected Steam build history"} ({watch?.buildHistory?.length??0})</summary>
 {watch?.buildHistory?.length?<ul>{watch.buildHistory.map((item,index)=><li key={item.detectedAt+":"+index}>{item.from} → {item.to} — {new Date(item.detectedAt).toLocaleString(i18n.language)}</li>)}</ul>:<p>{pl?"Brak zarejestrowanych zmian.":"No recorded changes."}</p>}
 <small>{pl?"Data wykrycia zmiany Build ID, nie dokładny czas instalacji; zmiana może również oznaczać cofnięcie wersji.":"Detection date, not exact install time; a build change may also indicate a rollback."}</small>
 </details>
 {watch?.lastChecked&&<p>{pl?"Ostatnie sprawdzenie":"Last checked"}: {new Date(watch.lastChecked).toLocaleString(i18n.language)}</p>}
 <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button type="button" disabled={!ready||busy} onClick={()=>void act(false)}>{pl?"Zapisz ustawienia":"Save settings"}</button><button type="button" disabled={!ready||busy} onClick={()=>void act(true)}>{pl?"Sprawdź teraz":"Check now"}</button>
 {shop==="steam"&&watch?.updateState==="required"&&<button type="button" disabled={busy} onClick={()=>void prepareUpdate()}>{pl?"Zrób kopię i przejdź do aktualizacji":"Back up saves and go to update"}</button>}
 {official&&<button type="button" disabled={busy} onClick={()=>void window.electron.krystaGameWatchOpenClient(shop,id).catch(e=>setNotice(String(e)))}>{shop==="steam"&&watch?.updateState==="required"?(pl?"Przejdź do aktualizacji Steam":"Go to Steam downloads"):(pl?"Otwórz oficjalny klient":"Open official client")}</button>}</div>
 {shop==="steam"&&watch?.updateState==="required"&&<small>{pl?"Kopia obejmuje wykryte zapisy; Steam może aktualizować gry niezależnie od Krysty.":"Backup covers detected saves; Steam may update games independently of Krysta."}</small>}
 <small>{pl?"Częstotliwość sprawdzania określają ustawienia globalne. Wersja lokalna pochodzi z manifestu, metadanych EXE lub pliku wersji i może różnić się od numeracji patchy. Najnowszy numer wersji pochodzi z tytułu wpisu Steam i nie potwierdza dostępności instalatora. Aktualizacje instaluje oficjalny klient.":"Check interval follows global settings. Local version comes from a manifest, EXE metadata or a version file and may differ from patch numbering. Latest version is inferred from Steam post titles, not installer availability. Official clients handle installation."}</small>
 {watch?.error&&<p role="alert">{watch.error}</p>}{notice&&<p role="status">{notice}</p>}
 </section>;
}
