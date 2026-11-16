import {useEffect,useState,useCallback} from "react";
import {useTranslation} from "react-i18next";
import {Film,FolderOpen,Play,Trash2,Square} from "lucide-react";
import "./krysta-recordings.scss";
type State=Awaited<ReturnType<typeof window.electron.krystaRecordingsState>>;
export default function KrystaRecordings(){
 const {i18n}=useTranslation();const pl=i18n.language.startsWith("pl");
 const [state,setState]=useState<State|null>(null),[error,setError]=useState(""),[search,setSearch]=useState(""),[busy,setBusy]=useState(false),[deleteId,setDeleteId]=useState("");
 const refresh=useCallback(async()=>{try{setState(await window.electron.krystaRecordingsState());}catch(e){setError(String(e));}},[]);
 useEffect(()=>{void refresh();const timer=setInterval(()=>{if(!document.hidden)void refresh();},3000);return()=>clearInterval(timer);},[refresh]);
 const action=async(fn:()=>Promise<void>)=>{setError("");setBusy(true);try{await fn();await refresh();}catch(e){setError(String(e));}finally{setBusy(false);}};
 const clips=state?.clips.filter(c=>(c.game+" "+c.achievement).toLocaleLowerCase().includes(search.toLocaleLowerCase()))??[];
 return <main className="krysta-recordings">
  <header><Film size={25}/><h1>{pl?"Nagrania":"Recordings"}</h1><button onClick={()=>void action(window.electron.krystaRecordingsFolder)} disabled={busy}><FolderOpen size={16}/>{pl?"Otwórz folder":"Open folder"}</button></header>
  <section className="krysta-recordings__settings">
   <p>{state?.settings.enabled?(pl?"Automatyczne nagrywanie osiągnięć jest włączone.":"Automatic achievement recording is enabled."):(pl?"Automatyczne nagrywanie osiągnięć jest wyłączone. Włącz je w ustawieniach zrzutów ekranu.":"Automatic achievement recording is disabled. Enable it in screenshot settings.")}</p>
   {state?.recording&&<div role="status" className="krysta-recordings__status"><span>{pl?"Nagrywanie…":"Recording…"}</span><button onClick={()=>void action(window.electron.krystaRecordingStop)}><Square size={14}/>{pl?"Zatrzymaj":"Stop"}</button></div>}
   {(error||state?.lastError)&&<p role="alert">{error||state?.lastError}</p>}
  </section>
  <section><h2>{pl?"Moje nagrania":"My recordings"} ({state?.clips.length??0})</h2>
   <input className="krysta-recordings__search" aria-label={pl?"Szukaj nagrań":"Search recordings"} placeholder={pl?"Szukaj gry lub osiągnięcia…":"Search games or achievements…"} value={search} onChange={e=>setSearch(e.target.value)}/>
   {!state?<p>{pl?"Wczytywanie…":"Loading…"}</p>:clips.length===0?<p>{pl?"Brak nagrań do wyświetlenia.":"No recordings to show."}</p>:<div className="krysta-recordings__grid">{clips.map(c=><article key={c.id}>
    <div className="krysta-recordings__preview"><Film size={32}/><span>{c.duration}s · {Math.round(c.size/1024/1024*10)/10} MB</span></div>
    <strong>{c.game}</strong><span>{c.achievement}</span><small>{new Date(c.createdAt).toLocaleString(i18n.language)} · {c.audio?(pl?"Z dźwiękiem":"With audio"):(pl?"Bez dźwięku":"No audio")}</small>
    {deleteId===c.id?<div><button disabled={busy} onClick={()=>{setDeleteId("");void action(()=>window.electron.krystaRecordingDelete(c.id));}}>{pl?"Potwierdź usunięcie":"Confirm deletion"}</button><button onClick={()=>setDeleteId("")}>{pl?"Anuluj":"Cancel"}</button></div>:<div><button disabled={busy} onClick={()=>void action(()=>window.electron.krystaRecordingOpen(c.id))}><Play size={15}/>{pl?"Odtwórz":"Play"}</button><button disabled={busy} onClick={()=>setDeleteId(c.id)}><Trash2 size={15}/>{pl?"Usuń":"Delete"}</button></div>}
   </article>)}</div>}
  </section>
 </main>;
}
