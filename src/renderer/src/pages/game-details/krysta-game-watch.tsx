import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
type Watch=Awaited<ReturnType<typeof window.electron.krystaGameWatchGet>>;
export function KrystaGameWatch({shop,id}:{shop:string;id:string}){
 const {i18n}=useTranslation();const pl=i18n.language.startsWith("pl");
 const [watch,setWatch]=useState<Watch>(null),[enabled,setEnabled]=useState(false),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");
 useEffect(()=>{let active=true;setReady(false);setNotice("");setWatch(null);
 void window.electron.krystaGameWatchGet(shop,id).then(w=>{if(active){setWatch(w);setEnabled(w?.enabled??false);setReady(true);}}).catch(e=>{if(active)setNotice(String(e));});
 return()=>{active=false;};},[shop,id]);
 const act=async(check:boolean)=>{setBusy(true);setNotice("");try{const w=await window.electron.krystaGameWatchSet(shop,id,enabled);setWatch(w);if(check)setWatch(await window.electron.krystaGameWatchCheck(shop,id));else setNotice(pl?"Zapisano ustawienia.":"Settings saved.");}catch(e){setNotice(String(e));}finally{setBusy(false);}};
 const official=shop==="steam"||shop==="epic"||(shop==="custom"&&/^(ubi-owned-|ubisoft-)/.test(id));
 return <section style={{padding:16,border:"1px solid #444",borderRadius:8,display:"flex",flexDirection:"column",gap:10}}>
 <h3>{pl?"Monitor aktualizacji gry":"Game update monitor"}</h3>
 <label><input type="checkbox" checked={enabled} disabled={!ready||busy} onChange={e=>setEnabled(e.target.checked)}/> {pl?"Powiadamiaj o nowych patchach":"Notify me about new patches"}</label>
 <p>{pl?"Zainstalowana wersja (automatycznie)":"Installed version (automatic)"}: {watch?.installedVersion||(pl?"Nie wykryto":"Not detected")}</p>
 {watch?.versionSource&&<small>{pl?"Źródło: metadane EXE":"Source: EXE metadata"} ({watch.versionSource==="product"?"ProductVersion":"FileVersion"})</small>}
 <p>{pl?"Najnowsza wykryta wersja":"Latest detected version"}: {watch?.latestVersion??"—"}</p>
 {watch?.latestTitle&&<p>{watch.latestTitle}</p>}
 {watch?.lastChecked&&<p>{pl?"Ostatnie sprawdzenie":"Last checked"}: {new Date(watch.lastChecked).toLocaleString(i18n.language)}</p>}
 <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button type="button" disabled={!ready||busy} onClick={()=>void act(false)}>{pl?"Zapisz ustawienia":"Save settings"}</button><button type="button" disabled={!ready||busy} onClick={()=>void act(true)}>{pl?"Sprawdź teraz":"Check now"}</button>
 {official&&<button type="button" onClick={()=>void window.electron.krystaGameWatchOpenClient(shop,id).catch(e=>setNotice(String(e)))}>{pl?"Otwórz oficjalny klient":"Open official client"}</button>}</div>
 <small>{pl?"Sprawdzanie co 6 godzin podczas działania launchera. Wersja lokalna pochodzi z metadanych EXE i może różnić się od numeracji patchy. Najnowszy numer wersji pochodzi z tytułu wpisu Steam i nie potwierdza dostępności instalatora. Aktualizacje instaluje oficjalny klient.":"Checks every 6 hours while the launcher runs. Local version comes from EXE metadata and may differ from patch numbering. Latest version is inferred from Steam post titles, not installer availability. Official clients handle installation."}</small>
 {watch?.error&&<p role="alert">{watch.error}</p>}{notice&&<p role="status">{notice}</p>}
 </section>;
}
