import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
type Watch=Awaited<ReturnType<typeof window.electron.krystaGameWatchGet>>;
export function KrystaGameWatch({shop,id}:{shop:string;id:string}){
 const {i18n}=useTranslation();const pl=i18n.language.startsWith("pl");
 const [watch,setWatch]=useState<Watch>(null),[override,setOverride]=useState<"inherit"|"on"|"off">("inherit"),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");
 useEffect(()=>{let active=true;setReady(false);setNotice("");setWatch(null);
 void window.electron.krystaGameWatchGet(shop,id).then(w=>{if(active){setWatch(w);setOverride(w?.override??"inherit");setReady(true);}}).catch(e=>{if(active)setNotice(String(e));});
 return()=>{active=false;};},[shop,id]);
 const act=async(check:boolean)=>{setBusy(true);setNotice("");try{const w=await window.electron.krystaGameWatchSet(shop,id,override);setWatch(w);if(check)setWatch(await window.electron.krystaGameWatchCheck(shop,id));else setNotice(pl?"Zapisano ustawienia.":"Settings saved.");}catch(e){setNotice(String(e));}finally{setBusy(false);window.dispatchEvent(new Event("krysta:patch-badges"));}};
 const official=shop==="steam"||shop==="epic"||(shop==="custom"&&/^(ubi-owned-|ubisoft-)/.test(id));
 return <section style={{padding:16,border:"1px solid #444",borderRadius:8,display:"flex",flexDirection:"column",gap:10}}>
 <h3>{pl?"Monitor aktualizacji gry":"Game update monitor"}</h3>
 <label>{pl?"Monitorowanie tej gry":"Monitor this game"} <select value={override} disabled={!ready||busy} onChange={e=>setOverride(e.target.value as "inherit"|"on"|"off")} style={{background:"#202020",color:"inherit",padding:6,border:"1px solid #555",borderRadius:4}}><option value="inherit">{pl?"Ustawienia globalne":"Global settings"}</option><option value="on">{pl?"Zawsze włączone":"Always enabled"}</option><option value="off">{pl?"Wyłączone":"Disabled"}</option></select></label>
 <small>{watch?.enabled?(pl?"Monitorowanie aktywne":"Monitoring enabled"):(pl?"Monitorowanie nieaktywne":"Monitoring disabled")}</small>
 <p>{pl?"Zainstalowana wersja (automatycznie)":"Installed version (automatic)"}: {watch?.installedVersion||(pl?"Nie wykryto":"Not detected")}</p>
 {watch?.versionSource&&<small>{pl?"Źródło: metadane EXE":"Source: EXE metadata"} ({watch.versionSource==="product"?"ProductVersion":"FileVersion"})</small>}
 <p>{pl?"Stan aktualizacji (Steam)":"Update state (Steam)"}: <strong>{watch?.updateState==="required"?(pl?"Aktualizacja wymagana":"Update required"):watch?.updateState==="not-reported"?(pl?"Steam nie zgłasza aktualizacji":"Steam reports no update"):(pl?"Niepotwierdzony":"Unconfirmed")}</strong></p>
 {watch?.steamBuildId&&<small>Steam Build ID: {watch.steamBuildId}</small>}
 <p>{pl?"Wersja z ogłoszenia o patchu":"Version from patch announcement"}: {watch?.latestVersion??"—"}</p>
 {watch?.pendingPatch&&<div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}><strong>{pl?"Nowy patch":"New patch"}: {watch.pendingPatch}</strong><button type="button" disabled={busy} onClick={()=>{void window.electron.krystaGameWatchDismiss(shop,id).then(()=>{setWatch(w=>w?{...w,pendingPatch:undefined}:w);window.dispatchEvent(new Event("krysta:patch-badges"));}).catch(e=>setNotice(String(e)));}}>{pl?"Oznacz jako przeczytany":"Mark as read"}</button></div>}
 {watch?.latestTitle&&<p>{watch.latestTitle}</p>}
 {watch?.lastChecked&&<p>{pl?"Ostatnie sprawdzenie":"Last checked"}: {new Date(watch.lastChecked).toLocaleString(i18n.language)}</p>}
 <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button type="button" disabled={!ready||busy} onClick={()=>void act(false)}>{pl?"Zapisz ustawienia":"Save settings"}</button><button type="button" disabled={!ready||busy} onClick={()=>void act(true)}>{pl?"Sprawdź teraz":"Check now"}</button>
 {official&&<button type="button" onClick={()=>void window.electron.krystaGameWatchOpenClient(shop,id).catch(e=>setNotice(String(e)))}>{shop==="steam"&&watch?.updateState==="required"?(pl?"Przejdź do aktualizacji Steam":"Go to Steam downloads"):(pl?"Otwórz oficjalny klient":"Open official client")}</button>}</div>
 <small>{pl?"Częstotliwość sprawdzania określają ustawienia globalne. Wersja lokalna pochodzi z metadanych EXE i może różnić się od numeracji patchy. Najnowszy numer wersji pochodzi z tytułu wpisu Steam i nie potwierdza dostępności instalatora. Aktualizacje instaluje oficjalny klient.":"Check interval follows global settings. Local version comes from EXE metadata and may differ from patch numbering. Latest version is inferred from Steam post titles, not installer availability. Official clients handle installation."}</small>
 {watch?.error&&<p role="alert">{watch.error}</p>}{notice&&<p role="status">{notice}</p>}
 </section>;
}
