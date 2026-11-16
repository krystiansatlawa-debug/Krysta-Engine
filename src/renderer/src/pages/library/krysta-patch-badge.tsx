import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownIcon } from "@primer/octicons-react";
import type { LibraryGame } from "@types";
type Patch={shop:string;id:string;title:string;kind?:"required"|"patch"};
const listeners=new Set<()=>void>();
let snapshot:Patch[]=[];
let timer:ReturnType<typeof setInterval>|undefined;
let busy=false;
function refresh(){if(busy)return;busy=true;void window.electron.krystaGameWatchBadges().then(value=>{if(JSON.stringify(value)!==JSON.stringify(snapshot)){snapshot=value;listeners.forEach(fn=>fn());}}).catch(()=>{}).finally(()=>{busy=false;});}
function subscribe(fn:()=>void){listeners.add(fn);if(!timer){refresh();timer=setInterval(refresh,15000);window.addEventListener("focus",refresh);window.addEventListener("krysta:patch-badges",refresh);}return()=>{listeners.delete(fn);if(!listeners.size&&timer){clearInterval(timer);timer=undefined;window.removeEventListener("focus",refresh);window.removeEventListener("krysta:patch-badges",refresh);}};}
const getSnapshot=()=>snapshot;
export const useKrystaPendingPatches=()=>useSyncExternalStore(subscribe,getSnapshot);
export function findKrystaPendingPatch(game:LibraryGame,patches:Patch[]){
 const members="members" in game&&Array.isArray(game.members)?game.members as LibraryGame[]:[game];
 const matching=patches.filter(p=>members.some(m=>m.shop===p.shop&&m.objectId===p.id));return matching.find(p=>p.kind==="required")??matching[0];
}
export function KrystaPatchBadge({game}:{game:LibraryGame}){
 const {i18n}=useTranslation();const pl=i18n.language.startsWith("pl");
 const patches=useKrystaPendingPatches();
 const patch=findKrystaPendingPatch(game,patches);
 if(!patch)return null;
 return <span title={patch.title} aria-label={(pl?"Nowy patch: ":"New patch: ")+patch.title} style={{display:"inline-flex",alignItems:"center",gap:4,background:"#245b47",color:"#fff",padding:"3px 6px",borderRadius:4,fontSize:11,fontWeight:600,whiteSpace:"nowrap"}}><ArrowDownIcon size={12}/>{patch.kind==="required"?(pl?"Aktualizacja wymagana":"Update required"):(pl?"Nowy patch":"New patch")}</span>;
}

export function KrystaUpdateCenterActions({patches}:{patches:Patch[]}) {
 const {i18n}=useTranslation();
 const pl=i18n.language.startsWith("pl");
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState("");
 const required=patches.find(p=>p.shop==="steam"&&p.kind==="required");
 const act=async(scan:boolean)=>{
  setBusy(true);setNotice("");
  try {
   if(scan){await window.electron.krystaGameWatchScan();setNotice(pl?"Zlecono skan monitorowanych gier.":"Requested scan of monitored games.");}
   else if(required){await window.electron.krystaGameWatchOpenClient(required.shop,required.id);setNotice(pl?"Przekazano żądanie otwarcia Steam.":"Requested Steam to open.");}
  }catch(e){setNotice(String(e));}
  finally{setBusy(false);refresh();}
 };
 return <>
  <button type="button" disabled={busy} onClick={()=>void act(true)}>{pl?"Sprawdź aktualizacje":"Check updates"}</button>
  <button type="button" disabled={busy||!required} onClick={()=>void act(false)}>{pl?"Otwórz kolejkę Steam":"Open Steam queue"}</button>
  {notice&&<small role="status">{notice}</small>}
 </>;
}
