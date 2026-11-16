import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import "./krysta-game-mods.scss";
type Mod = Awaited<ReturnType<typeof window.electron.nexusMods>>[number];
type File = Awaited<ReturnType<typeof window.electron.nexusFiles>>[number];
const normalize=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,"");
export function KrystaGameMods({title}:{title:string}){
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
 useEffect(()=>{void window.electron.nexusStatus().then(s=>setConnected(s.connected)).catch(()=>setNotice(pl?"Nie udało się sprawdzić konta.":"Account status unavailable."));},[pl]);
 useEffect(()=>{if(!connected)return;let active=true;void window.electron.nexusGames().then(result=>{if(!active)return;setGames(result);setDomain(result.find(g=>normalize(g.name)===normalize(title))?.domain??"");}).catch(()=>{if(active)setNotice(pl?"Nie udało się pobrać gier.":"Unable to load games.");});return()=>{active=false;};},[connected,title,pl]);
 useEffect(()=>{setMods([]);setSelected(null);setFiles([]);if(!connected||!domain)return;let active=true;setBusy(true);void window.electron.nexusMods(domain,sort).then(result=>{if(active)setMods(result);}).catch(()=>{if(active)setNotice(pl?"Nie udało się pobrać modów.":"Unable to load mods.");}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[connected,domain,sort,pl]);
 useEffect(()=>{setFiles([]);if(selected===null||!domain)return;let active=true;void window.electron.nexusFiles(domain,selected).then(result=>{if(active)setFiles(result);}).catch(()=>{if(active)setNotice(pl?"Nie udało się pobrać plików.":"Unable to load files.");});return()=>{active=false;};},[domain,selected,pl]);
 const connect=async()=>{setBusy(true);setNotice("");try{await window.electron.nexusConnect(key.trim());setConnected(true);setKey("");}catch{setNotice(pl?"Nie udało się połączyć. Sprawdź klucz API.":"Connection failed. Check API key.");}finally{setBusy(false);}};
 return <section className="krysta-mods"><header><h2>Nexus Mods — {title}</h2>{connected&&<button type="button" onClick={async()=>{try{await window.electron.nexusDisconnect();setConnected(false);setMods([]);}catch{setNotice("Disconnect failed");}}}>{pl?"Rozłącz":"Disconnect"}</button>}</header>
 {!connected?<div className="krysta-mods__login"><p>{pl?"Połącz konto Nexus Mods za pomocą osobistego klucza API.":"Connect your Nexus Mods account using a personal API key."}</p><button type="button" onClick={()=>void window.electron.openExternal("https://www.nexusmods.com/users/myaccount?tab=api")}>{pl?"Pobierz klucz API":"Get API key"}</button><input type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)} placeholder="Nexus API key"/><button type="button" disabled={!key.trim()||busy} onClick={()=>void connect()}>{pl?"Połącz":"Connect"}</button></div>:<>
 <div className="krysta-mods__toolbar"><select aria-label="Game" value={domain} onChange={e=>setDomain(e.target.value)}><option value="">{pl?"Wybierz grę":"Choose game"}</option>{games.map(g=><option key={g.domain} value={g.domain}>{g.name}</option>)}</select><input placeholder={pl?"Filtruj wyświetlane mody":"Filter displayed mods"} value={query} onChange={e=>setQuery(e.target.value)}/><select value={sort} onChange={e=>setSort(e.target.value)}><option value="trending">{pl?"Popularne":"Trending"}</option><option value="latest">{pl?"Najnowsze":"Latest"}</option><option value="updated">{pl?"Zaktualizowane":"Updated"}</option></select></div>
 {busy&&<p>{pl?"Pobieranie modów...":"Loading mods..."}</p>}
 {mods.filter(m=>m.name.toLowerCase().includes(query.toLowerCase())).map(m=><article key={m.id} className="krysta-mods__card">{/^https:\/\//i.test(m.picture)&&<img src={m.picture} alt="" loading="lazy" referrerPolicy="no-referrer"/>}<div><h3>{m.name}</h3><small>{m.author} · {m.version}</small><p>{m.summary}</p><button type="button" onClick={()=>setSelected(selected===m.id?null:m.id)}>{pl?"Pliki":"Files"}</button>{selected===m.id&&<div>{files.map(f=><p key={f.id}>{f.name} · {f.version}</p>)}<button type="button" onClick={()=>void window.electron.openExternal("https://www.nexusmods.com/"+domain+"/mods/"+m.id+"?tab=files")}>{pl?"Pobierz w Nexus Mods":"Download on Nexus Mods"}</button></div>}</div></article>)}</>}
 {notice&&<p role="status">{notice}</p>}</section>;
}
