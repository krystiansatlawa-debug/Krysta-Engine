import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import "./krysta-game-mods.scss";
type Mod = Awaited<ReturnType<typeof window.electron.nexusMods>>[number];
type File = Awaited<ReturnType<typeof window.electron.nexusFiles>>[number];
const normalize=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,"");
export function KrystaGameMods({title,gameKey}:{title:string;gameKey:string}){
 const {i18n}=useTranslation(); const pl=i18n.language.startsWith("pl");
 const [connected,setConnected]=useState(false);
 const [key,setKey]=useState("");
 const [domain,setDomain]=useState("");
 const [games,setGames]=useState<{name:string;domain:string}[]>([]);
 const [mods,setMods]=useState<Mod[]>([]);
 const [sort,setSort]=useState("trending");
 const [query,setQuery]=useState("");
 const [notice,setNotice]=useState("");
 const [busy,setBusy]=useState(false);
 const [selected,setSelected]=useState<number|null>(null);
 const [files,setFiles]=useState<File[]>([]);
 const [installed,setInstalled]=useState<Awaited<ReturnType<typeof window.electron.nexusInstalled>>>([]);
 const scoped=installed.filter(m=>m.gameKey===gameKey);
 const [working,setWorking]=useState(false);
 const [updates,setUpdates]=useState<Awaited<ReturnType<typeof window.electron.nexusUpdates>>["updates"]>([]);
 const [checking,setChecking]=useState(false);
 const [checkFailed,setCheckFailed]=useState(false);
 const [checkTick,setCheckTick]=useState(0);
 useEffect(()=>{
  if(!connected){setUpdates([]);setCheckFailed(false);return;}
  let active=true, running=false;
  const check=async()=>{if(running)return;running=true;if(active)setChecking(true);try{const result=await window.electron.nexusUpdates(gameKey);if(active){setUpdates(result.updates);setCheckFailed(result.failed>0);}}catch{if(active)setCheckFailed(true);}finally{running=false;if(active)setChecking(false);}};
  void check();
  const timer=setInterval(()=>void check(),30*60*1000);
  return()=>{active=false;clearInterval(timer);};
 },[connected,gameKey,checkTick]);
 const reloadInstalled=async()=>setInstalled(await window.electron.nexusInstalled());
 useEffect(()=>{void reloadInstalled().catch(()=>{});},[]);
 const operate=async(action:()=>Promise<boolean>)=>{setWorking(true);setNotice("");try{if(await action()){await reloadInstalled();setCheckTick(n=>n+1);setNotice(pl?"Operacja zakończona.":"Operation complete.");}}catch(e){setNotice((pl?"Operacja nie powiodła się: ":"Operation failed: ")+String(e));}finally{setWorking(false);}};
 useEffect(()=>{void window.electron.nexusStatus().then(s=>setConnected(s.connected)).catch(()=>setNotice(pl?"Nie udało się sprawdzić konta.":"Account status unavailable."));},[pl]);
 useEffect(()=>{if(!connected)return;let active=true;void window.electron.nexusGames().then(result=>{if(!active)return;setGames(result);setDomain(result.find(g=>normalize(g.name)===normalize(title))?.domain??"");}).catch(()=>{if(active)setNotice(pl?"Nie udało się pobrać gier.":"Unable to load games.");});return()=>{active=false;};},[connected,title,pl]);
 useEffect(()=>{setMods([]);setSelected(null);setFiles([]);if(!connected||!domain)return;let active=true;setBusy(true);void window.electron.nexusMods(domain,sort).then(result=>{if(active)setMods(result);}).catch(()=>{if(active)setNotice(pl?"Nie udało się pobrać modów.":"Unable to load mods.");}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[connected,domain,sort,pl]);
 useEffect(()=>{setFiles([]);if(selected===null||!domain)return;let active=true;void window.electron.nexusFiles(domain,selected).then(result=>{if(active)setFiles(result);}).catch(()=>{if(active)setNotice(pl?"Nie udało się pobrać plików.":"Unable to load files.");});return()=>{active=false;};},[domain,selected,pl]);
 const connect=async()=>{setBusy(true);setNotice("");try{await window.electron.nexusConnect(key.trim());setConnected(true);setKey("");}catch{setNotice(pl?"Nie udało się połączyć. Sprawdź klucz API.":"Connection failed. Check API key.");}finally{setBusy(false);}};
 return <section className="krysta-mods"><header><h2>Nexus Mods — {title}</h2>{connected&&<button type="button" onClick={async()=>{try{await window.electron.nexusDisconnect();setConnected(false);setMods([]);}catch{setNotice("Disconnect failed");}}}>{pl?"Rozłącz":"Disconnect"}</button>}</header>
 <div className="krysta-mods__toolbar"><button type="button" disabled={working} onClick={()=>void operate(()=>window.electron.nexusInstallLocal(gameKey))}>{pl?"Zainstaluj z archiwum":"Install from archive"}</button></div>
 <div className="krysta-mods__toolbar">{connected&&<button type="button" disabled={checking||working} onClick={()=>setCheckTick(n=>n+1)}>{checking?(pl?"Sprawdzanie…":"Checking…"):(pl?"Sprawdź aktualizacje":"Check updates")} ({updates.length})</button>}{checkFailed&&<small>{pl?"Nie udało się sprawdzić części aktualizacji.":"Some update checks failed."}</small>}</div>
 <details open><summary>{pl?"Zainstalowane mody":"Installed mods"} ({scoped.length})</summary>{scoped.map(m=><article key={m.id} className="krysta-mods__card"><div><h3>{m.name}</h3><p>{m.nexus?.version && ("v"+m.nexus.version+" · ")}{m.root} · {m.enabled?(pl?"Włączony":"Enabled"):(pl?"Wyłączony":"Disabled")}</p>{updates.some(u=>u.id===m.id)&&<><p>{pl?"Dostępna aktualizacja":"Update available"}: {updates.find(u=>u.id===m.id)?.version}</p><button type="button" disabled={working||!m.enabled} onClick={()=>void operate(()=>window.electron.nexusApplyUpdate(m.id))}>{pl?"Aktualizuj":"Update"}</button></>}<button type="button" disabled={working} onClick={()=>void operate(()=>window.electron.nexusToggle(m.id,!m.enabled))}>{m.enabled?(pl?"Wyłącz":"Disable"):(pl?"Włącz":"Enable")}</button><button type="button" disabled={working} onClick={()=>void operate(()=>window.electron.nexusRemove(m.id))}>{pl?"Usuń":"Remove"}</button></div></article>)}</details>
 {!connected?<div className="krysta-mods__login"><p>{pl?"Połącz konto Nexus Mods za pomocą osobistego klucza API.":"Connect your Nexus Mods account using a personal API key."}</p><button type="button" onClick={()=>void window.electron.openExternal("https://www.nexusmods.com/users/myaccount?tab=api")}>{pl?"Pobierz klucz API":"Get API key"}</button><input type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)} placeholder="Nexus API key"/><button type="button" disabled={!key.trim()||busy} onClick={()=>void connect()}>{pl?"Połącz":"Connect"}</button></div>:<>
 <div className="krysta-mods__toolbar"><select aria-label="Game" value={domain} onChange={e=>setDomain(e.target.value)}><option value="">{pl?"Wybierz grę":"Choose game"}</option>{games.map(g=><option key={g.domain} value={g.domain}>{g.name}</option>)}</select><input placeholder={pl?"Filtruj wyświetlane mody":"Filter displayed mods"} value={query} onChange={e=>setQuery(e.target.value)}/><select value={sort} onChange={e=>setSort(e.target.value)}><option value="trending">{pl?"Popularne":"Trending"}</option><option value="latest">{pl?"Najnowsze":"Latest"}</option><option value="updated">{pl?"Zaktualizowane":"Updated"}</option></select></div>
 {busy&&<p>{pl?"Pobieranie modów...":"Loading mods..."}</p>}
 {mods.filter(m=>m.name.toLowerCase().includes(query.toLowerCase())).map(m=><article key={m.id} className="krysta-mods__card">{/^https:\/\//i.test(m.picture)&&<img src={m.picture} alt="" loading="lazy" referrerPolicy="no-referrer"/>}<div><h3>{m.name}</h3><small>{m.author} · {m.version}</small><p>{m.summary}</p><button type="button" onClick={()=>setSelected(selected===m.id?null:m.id)}>{pl?"Pliki":"Files"}</button>{selected===m.id&&<div>{files.map(f=><p key={f.id}>{f.name} · {f.version} <button type="button" disabled={working} onClick={()=>void operate(()=>window.electron.nexusDownload(domain,m.id,f.id))}>{pl?"Pobierz":"Download"}</button> <button type="button" disabled={working} onClick={()=>void operate(()=>window.electron.nexusInstall(domain,m.id,f.id,gameKey))}>{pl?"Zainstaluj":"Install"}</button></p>)}<button type="button" onClick={()=>void window.electron.openExternal("https://www.nexusmods.com/"+domain+"/mods/"+m.id+"?tab=files")}>{pl?"Pobierz w Nexus Mods":"Download on Nexus Mods"}</button></div>}</div></article>)}</>}
 {notice&&<p role="status">{notice}</p>}</section>;
}
