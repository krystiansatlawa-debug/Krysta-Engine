import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, Image as ImageIcon, RefreshCw } from "lucide-react";
import type { LocalScreenshot } from "@types";
import { toLocalScreenshotUrl } from "@shared";
import { GalleryLightbox } from "../game-details/gallery-slider/gallery-lightbox";
import type { GalleryMediaItem } from "../game-details/gallery-slider/gallery-slider";
import "./krysta-screenshots.scss";

const PAGE_SIZE = 80;
export default function KrystaScreenshots() {
 const { i18n } = useTranslation();
 const pl = i18n.language.startsWith("pl");
 const [items, setItems] = useState<LocalScreenshot[]>([]);
 const [loaded, setLoaded] = useState(false);
 const [error, setError] = useState("");
 const [search, setSearch] = useState("");
 const [gameFilter, setGameFilter] = useState("");
 const [limit, setLimit] = useState(PAGE_SIZE);
 const [selectedId, setSelectedId] = useState<string | null>(null);
 const revision = useRef(0);
 const mounted = useRef(true);
 const reload = useCallback(async()=>{
  const started = revision.current;
  try {
   const latest = await window.electron.getLocalScreenshots();
   if (!mounted.current || started !== revision.current) return;
   setItems(latest);
   setError("");
  } catch(e) {
   if (mounted.current && started === revision.current) setError(String(e));
  } finally {
   if (mounted.current && started === revision.current) setLoaded(true);
  }
 },[]);
 useEffect(()=>{
  mounted.current = true;
  // Subscribe first, so an older pending read cannot overwrite live changes.
  const stop = window.electron.onLocalScreenshotsChange((next)=>{
   revision.current++;
   setItems(next);
   setLoaded(true);
   setError("");
  });
  void reload();
  return()=>{mounted.current=false;revision.current++;stop();};
 },[reload]);
 const games = useMemo(()=>[...new Set(items.map(s=>s.gameTitle).filter(Boolean))].sort((a,b)=>a.localeCompare(b,i18n.language)),[items,i18n.language]);
 const filtered = useMemo(()=>items
  .filter(s=>(!gameFilter||s.gameTitle===gameFilter)&&(!search||(s.gameTitle+" "+(s.customGameTitle??"")).toLocaleLowerCase().includes(search.toLocaleLowerCase())))
  .sort((a,b)=>b.capturedAt-a.capturedAt),[items,gameFilter,search]);
 const shown = filtered.slice(0,limit);
 const media = useMemo<GalleryMediaItem[]>(()=>filtered.map(s=>({
  id:s.clientId,type:"image" as const,
  src:toLocalScreenshotUrl(s.path),
  thumbnail:toLocalScreenshotUrl(s.previewPath??s.path),
  alt:(s.gameTitle||"Screenshot")+" – "+new Date(s.capturedAt).toLocaleString(i18n.language)
 })),[filtered,i18n.language]);
 const activeIndex = selectedId?media.findIndex(m=>m.id===selectedId):-1;
 const folder=async()=>{try{await window.electron.openScreenshotsFolder();}catch(e){setError(String(e));}};
 return <main className="krysta-screenshots">
  <header className="krysta-screenshots__header">
   <ImageIcon size={26}/>
   <div><h1>{pl?"Zrzuty ekranu":"Screenshots"}</h1><small>{pl?"Twoje lokalnie zapisane zdjęcia z gier":"Your local game screenshots"} · {items.length}</small></div>
   <div className="krysta-screenshots__buttons">
    <button type="button" onClick={()=>void reload()}><RefreshCw size={16}/>{pl?"Odśwież":"Refresh"}</button>
    <button type="button" onClick={()=>void folder()}><FolderOpen size={16}/>{pl?"Otwórz folder":"Open folder"}</button>
   </div>
  </header>
  <div className="krysta-screenshots__filters">
   <input aria-label={pl?"Szukaj gry":"Search game"} placeholder={pl?"Szukaj gry…":"Search game…"} value={search} onChange={e=>{setSearch(e.target.value);setLimit(PAGE_SIZE);}}/>
   <select aria-label={pl?"Filtruj według gry":"Filter by game"} value={gameFilter} onChange={e=>{setGameFilter(e.target.value);setLimit(PAGE_SIZE);}}>
    <option value="">{pl?"Wszystkie gry":"All games"}</option>
    {games.map(g=><option key={g} value={g}>{g}</option>)}
   </select>
  </div>
  {error&&<p role="alert">{error}</p>}
  {!loaded?<p role="status">{pl?"Wczytywanie zrzutów…":"Loading screenshots…"}</p>:
   filtered.length===0?<p>{pl?"Brak lokalnych zrzutów ekranu. Zdjęcia możesz robić podczas gry skrótem ustawionym w sekcji Zrzuty ekranu.":"No local screenshots. Capture them in a game with the shortcut configured in Screenshot settings."}</p>:
   <section className="krysta-screenshots__grid" aria-label={pl?"Galeria zrzutów ekranu":"Screenshot gallery"}>
    {shown.map(s=><button key={s.clientId} type="button" className="krysta-screenshots__tile" onClick={()=>setSelectedId(s.clientId)}>
     <img src={toLocalScreenshotUrl(s.previewPath??s.path)} alt={s.gameTitle} loading="lazy"/>
     <strong title={s.gameTitle}>{s.gameTitle}</strong>
     <small>{new Date(s.capturedAt).toLocaleString(i18n.language)}</small>
    </button>)}
   </section>}
  {filtered.length>shown.length&&<button className="krysta-screenshots__more" type="button" onClick={()=>setLimit(n=>n+PAGE_SIZE)}>{pl?"Pokaż więcej":"Show more"} ({filtered.length-shown.length})</button>}
  {activeIndex>=0&&<GalleryLightbox visible items={media} index={activeIndex} onClose={()=>setSelectedId(null)} onNavigate={i=>setSelectedId(media[i]?.id??null)} showFilmstrip={false} trapFocus/>}
 </main>;
}
