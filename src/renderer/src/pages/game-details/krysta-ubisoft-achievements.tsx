import {useEffect,useState,useRef,useCallback} from "react";
import {useTranslation} from "react-i18next";
import {Trophy,Lock,RefreshCw} from "lucide-react";
import "./krysta-game-updates.scss";
type Snapshot=Awaited<ReturnType<typeof window.electron.getUbisoftAchievements>>;
export function KrystaUbisoftAchievements({objectId}:{objectId:string}){
 const {i18n}=useTranslation(),pl=i18n.language.startsWith("pl");
 const [data,setData]=useState<Snapshot|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[filter,setFilter]=useState("all"),[search,setSearch]=useState("");
 const active=useRef(false),request=useRef(false),generation=useRef(0);
 const refresh=useCallback(async(force=false)=>{
  if(request.current)return;request.current=true;const currentGeneration=generation.current;setBusy(true);setError("");
  try{const next=await window.electron.getUbisoftAchievements(objectId,force);if(active.current&&currentGeneration===generation.current)setData(next);}
  catch{if(active.current&&currentGeneration===generation.current)setError(pl?"Nie udało się odczytać osiągnięć. Sprawdź połączenie z kontem Ubisoft w ustawieniach integracji.":"Could not read achievements. Check your Ubisoft account connection in integration settings.");}
  finally{if(currentGeneration===generation.current){request.current=false;if(active.current)setBusy(false);}}
 },[objectId,pl]);
 useEffect(()=>{generation.current++;request.current=false;active.current=true;setData(null);setError("");setBusy(false);void refresh();const timer=setInterval(()=>{if(!document.hidden)void refresh(true);},120000);return()=>{active.current=false;generation.current++;request.current=false;clearInterval(timer);};},[refresh]);
 const items=data?.items.filter(a=>(filter==="all"||(filter==="unlocked"?a.unlocked:!a.unlocked))&&(a.title+" "+a.description).toLocaleLowerCase().includes(search.toLocaleLowerCase()))??[];
 return <section className="krysta-updates" style={{padding:16,display:"flex",flexDirection:"column",gap:12}}>
  <header className="krysta-updates__header"><h2><Trophy size={18}/> {pl?"Osiągnięcia Ubisoft Connect":"Ubisoft Connect achievements"}</h2><button disabled={busy} onClick={()=>void refresh(true)}><RefreshCw size={14}/> {pl?"Odśwież":"Refresh"}</button></header>
  {data&&<><strong>{data.completed} / {data.total} {pl?"zdobytych":"unlocked"}</strong><progress max={data.total||1} value={data.completed}/><small>{pl?"Ostatni odczyt: ":"Last sync: "}{new Date(data.updatedAt).toLocaleString(i18n.language)}</small></>}
  {busy&&<p role="status">{pl?"Pobieranie osiągnięć…":"Loading achievements…"}</p>}
  {error&&<p role="alert">{error}{data&&(pl?" Pokazano ostatni odczyt.":" Showing last fetched data.")}</p>}
  {data&&<><nav className="krysta-game-tabs">{(["all","unlocked","locked"] as const).map(f=><button key={f} aria-pressed={f===filter} onClick={()=>setFilter(f)}>{f==="all"?(pl?"Wszystkie":"All"):f==="unlocked"?(pl?"Zdobyte":"Unlocked"):(pl?"Zablokowane":"Locked")}</button>)}</nav>
  <input aria-label={pl?"Szukaj osiągnięcia":"Search achievements"} placeholder={pl?"Szukaj osiągnięcia…":"Search achievements…"} value={search} onChange={e=>setSearch(e.target.value)} style={{padding:8,background:"#242424",color:"inherit",border:"1px solid #555",borderRadius:5}}/>
  {!items.length&&<p>{pl?"Brak osiągnięć do wyświetlenia.":"No achievements to display."}</p>}
  {items.map(a=><article key={a.id} style={{display:"flex",alignItems:"center",gap:12,padding:12,border:"1px solid #555",borderRadius:6,opacity:a.unlocked?1:.65}}>
   <div style={{width:48,height:48,flexShrink:0,display:"grid",placeItems:"center"}}>{a.icon?<img src={a.icon} alt="" loading="lazy" style={{width:48,height:48,objectFit:"contain"}}/>:a.unlocked?<Trophy/>:<Lock/>}</div>
   <div style={{flex:1,minWidth:0,overflowWrap:"anywhere"}}><strong>{a.title}</strong><p>{a.description}</p><small>{a.unlocked?(pl?"Zdobyte":"Unlocked"):(pl?"Zablokowane":"Locked")}{a.completionDate&&" · "+a.completionDate.replace("T"," ")}</small></div>
  </article>)}</>}
  <small>{pl?"Odczyt z konta Ubisoft, bez modyfikowania danych. Daty są podane w formacie źródłowym.":"Read-only Ubisoft account data; dates in source format."}</small>
 </section>;
}
