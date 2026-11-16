import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ToolsIcon } from "@primer/octicons-react";
import "./krysta-game-updates.scss";

type News = Awaited<ReturnType<typeof window.electron.getKrystaGameNews>>["items"][number];
function safeImage(value: string) {
  try {
    const url = new URL(value.replace("{STEAM_CLAN_IMAGE}", "https://clan.akamai.steamstatic.com/images"));
    if(url.protocol === "https:" && /(^|\.)(steamstatic\.com|akamaihd\.net|steamcommunity\.com|steamusercontent\.com)$/.test(url.hostname)) return url.href;
  } catch { /* no valid image */ }
  return "";
}
function parseContent(contents: string) {
  const doc = new DOMParser().parseFromString(contents, "text/html");
  doc.querySelectorAll("script,style,iframe,object").forEach(node=>node.remove());
  const bbImage=contents.match(/\[img\]([\s\S]*?)\[\/img\]/i)?.[1] ?? "";
  const image=safeImage(doc.querySelector("img")?.getAttribute("src") || bbImage);
  doc.querySelectorAll("br").forEach(node=>node.replaceWith("\n"));
  doc.querySelectorAll("p,li,h1,h2,h3,div").forEach(node=>node.append("\n"));
  const content=(doc.body.textContent ?? "").replace(/\[img\][\s\S]*?\[\/img\]/gi,"").replace(/\[\*\]/g,"• ").replace(/\[\/?(?:h[1-6]|b|i|u|list|olist|url|quote|table|tr|td|previewyoutube)(?:=[^\]]*)?\]/gi,"").trim();
  return { image,content };
}
export function KrystaGameUpdates({appId,title}:{appId:string;title:string}) {
  const {i18n}=useTranslation();
  const pl=i18n.language.startsWith("pl");
  const [items,setItems]=useState<News[]>([]);
  const [resolved,setResolved]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const [failed,setFailed]=useState(false);
  const [expanded,setExpanded]=useState<string|null>(null);
  const [retry,setRetry]=useState(0);
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
    {loading?<p role="status">{pl?"Pobieranie aktualizacji...":"Loading updates..."}</p>:failed?<div><p>{pl?"Nie udało się pobrać aktualizacji.":"Could not fetch updates."}</p><button type="button" onClick={()=>setRetry(n=>n+1)}>{pl?"Spróbuj ponownie":"Retry"}</button></div>:items.length===0?<p>{pl?"Nie znaleziono aktualności dla tej gry.":"No announcements found for this game."}</p>:items.map(item=>{
      const {image,content}=parseContent(item.contents);
      const isPatch=/patch|hotfix|update|changelog|fixes|aktualizac|lista zmian/i.test(item.title);
      return <article key={item.id} className="krysta-updates__article">
        <div className="krysta-updates__date">{item.date?new Date(item.date*1000).toLocaleDateString(pl?"pl-PL":"en-US",{day:"numeric",month:"long",year:"numeric"}):""}</div>
        <button type="button" className="krysta-updates__card" aria-expanded={expanded===item.id} onClick={()=>setExpanded(expanded===item.id?null:item.id)}>
          <div className="krysta-updates__thumb">{image?<img src={image} alt="" loading="lazy" onError={e=>{e.currentTarget.style.display="none";}}/>:null}<ToolsIcon size={32}/></div>
          <div className="krysta-updates__copy"><small>{isPatch?(pl?"AKTUALIZACJA / LISTA ZMIAN":"UPDATE / PATCH NOTES"):(pl?"AKTUALNOŚCI GRY":"GAME NEWS")}</small><strong>{item.title}</strong><p>{content.slice(0,240)}{content.length>240?"…":""}</p></div>
          <span aria-hidden="true">{expanded===item.id?"−":"+"}</span>
        </button>
        {expanded===item.id&&<div className="krysta-updates__body"><p>{content}</p>{/^https:\/\//i.test(item.url)&&<button type="button" onClick={()=>void window.electron.openExternal(item.url)}>{pl?"Oryginalny wpis":"Original announcement"}</button>}</div>}
      </article>;
    })}
  </section>;
}
