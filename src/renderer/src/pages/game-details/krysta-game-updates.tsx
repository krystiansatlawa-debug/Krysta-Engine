import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ToolsIcon } from "@primer/octicons-react";
import "./krysta-game-updates.scss";
import { KrystaGameWatch } from "./krysta-game-watch";

type News = Awaited<ReturnType<typeof window.electron.getKrystaGameNews>>["items"][number];
function safeImage(value: string) {
  try {
    const url = new URL(value.replace("{STEAM_CLAN_IMAGE}", "https://clan.akamai.steamstatic.com/images"));
    if(url.protocol === "https:" && /(^|\.)(steamstatic\.com|akamaihd\.net|steamcommunity\.com|steamusercontent\.com)$/.test(url.hostname)) return url.href;
  } catch { /* no valid image */ }
  return "";
}
function parseContent(contents: string) {
  const bbImages = /\[img(?:\s+src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))|=([^\]]+))?\]([\s\S]*?)\[\/img\]/gi;
  let image = "";
  const withoutImages = contents.replace(bbImages, (_match, doubleQuoted, singleQuoted, unquoted, assigned, body) => {
    if (!image) image = safeImage((doubleQuoted || singleQuoted || unquoted || assigned || body || "").trim());
    return "\n";
  });
  const doc = new DOMParser().parseFromString(withoutImages, "text/html");
  doc.querySelectorAll("script,style,iframe,object,template").forEach(node=>node.remove());
  if (!image) image = safeImage(doc.querySelector("img")?.getAttribute("src") || "");
  doc.querySelectorAll("br").forEach(node=>node.replaceWith("\n"));
  doc.querySelectorAll("p,li,h1,h2,h3,div").forEach(node=>node.append("\n"));
  const content = (doc.body.textContent ?? "")
    .replace(bbImages, "\n")
    .replace(/\[(?:\/?(?:p|h[1-6]|list|olist|quote|table|tr|br|hr))(?:[=\s][^\]]*)?\]/gi, "\n")
    .replace(/\[\*\]/g, "\n• ")
    .replace(/\[\/?(?:img|b|i|u|s|strike|spoiler|noparse|code|url|td|th|previewyoutube|youtube|video)(?:[=\s][^\]]*)?\]/gi, "")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { image, content };
}
export function KrystaGameUpdates({appId,title,shop,objectId}:{appId:string;title:string;shop?:string;objectId?:string}) {
  const {i18n}=useTranslation();
  const pl=i18n.language.startsWith("pl");
  const [items,setItems]=useState<News[]>([]);
  const [resolved,setResolved]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const [failed,setFailed]=useState(false);
  const [expanded,setExpanded]=useState<string|null>(null);
  const [retry,setRetry]=useState(0);
  const [filter,setFilter]=useState<"patch"|"news"|"all">("patch");
  const filtered=items.filter(item=>filter==="all"||item.category===filter);
  useEffect(()=>{
    let active=true;
    setLoading(true);setFailed(false);setItems([]);setResolved(null);setExpanded(null);
    void window.electron.getKrystaGameNews(appId,title).then(result=>{
      if(active){setItems(result.items);setResolved(result.appId);}
    }).catch(()=>{if(active)setFailed(true);}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[appId,title,retry]);
  return <section className="krysta-updates">
    <header className="krysta-updates__header"><h2>{pl?"Aktualizacje i lista zmian":"Updates and patch notes"}</h2>{resolved&&<span>Steam</span>}</header>
    {shop&&objectId&&<KrystaGameWatch key={shop+":"+objectId} shop={shop} id={objectId}/>}
    <nav className="krysta-game-tabs" aria-label={pl?"Typ wpisów":"Entry type"}>{(["patch","news","all"] as const).map(type=><button key={type} type="button" aria-pressed={filter===type} onClick={()=>{setFilter(type);setExpanded(null);}}>{type==="patch"?(pl?"Aktualizacje gry":"Game updates"):type==="news"?(pl?"Aktualności":"News"):(pl?"Wszystkie":"All")} ({type==="all"?items.length:items.filter(item=>item.category===type).length})</button>)}</nav>
    {loading?<p role="status">{pl?"Pobieranie aktualizacji...":"Loading updates..."}</p>:failed?<div><p>{pl?"Nie udało się pobrać aktualizacji.":"Could not fetch updates."}</p><button type="button" onClick={()=>setRetry(n=>n+1)}>{pl?"Spróbuj ponownie":"Retry"}</button></div>:filtered.length===0?<p>{filter==="patch"?(pl?"Nie znaleziono patchy w pobranych wpisach Steam.":"No patches found in the retrieved Steam posts."):(pl?"Brak wpisów w tej kategorii.":"No posts in this category.")}</p>:filtered.map(item=>{
      const {image,content}=parseContent(item.contents);
      const preview=content.replace(/\s+/g," ").trim();
      const isPatch=item.category==="patch";
      return <article key={item.id} className="krysta-updates__article">
        <div className="krysta-updates__date">{item.date?new Date(item.date*1000).toLocaleDateString(pl?"pl-PL":"en-US",{day:"numeric",month:"long",year:"numeric"}):""}</div>
        <button type="button" className="krysta-updates__card" aria-expanded={expanded===item.id} onClick={()=>setExpanded(expanded===item.id?null:item.id)}>
          <div className="krysta-updates__thumb">{image?<img src={image} alt="" loading="lazy" onError={e=>{e.currentTarget.style.display="none";}}/>:null}<ToolsIcon size={32}/></div>
          <div className="krysta-updates__copy"><small>{isPatch?(pl?"AKTUALIZACJA / LISTA ZMIAN":"UPDATE / PATCH NOTES"):(pl?"AKTUALNOŚCI GRY":"GAME NEWS")}</small><strong>{item.title}</strong><p>{preview.slice(0,240)}{preview.length>240?"…":""}</p></div>
          <span aria-hidden="true">{expanded===item.id?"−":"+"}</span>
        </button>
        {expanded===item.id&&<div className="krysta-updates__body"><p>{content}</p>{/^https:\/\//i.test(item.url)&&<button type="button" onClick={()=>void window.electron.openExternal(item.url)}>{pl?"Oryginalny wpis":"Original announcement"}</button>}</div>}
      </article>;
    })}
  </section>;
}
