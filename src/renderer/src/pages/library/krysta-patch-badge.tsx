import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownIcon } from "@primer/octicons-react";
import type { LibraryGame } from "@types";
type Patch={shop:string;id:string;title:string};
const listeners=new Set<()=>void>();
let snapshot:Patch[]=[];
let timer:ReturnType<typeof setInterval>|undefined;
let busy=false;
function refresh(){if(busy)return;busy=true;void window.electron.krystaGameWatchBadges().then(value=>{if(JSON.stringify(value)!==JSON.stringify(snapshot)){snapshot=value;listeners.forEach(fn=>fn());}}).catch(()=>{}).finally(()=>{busy=false;});}
function subscribe(fn:()=>void){listeners.add(fn);if(!timer){refresh();timer=setInterval(refresh,15000);window.addEventListener("focus",refresh);window.addEventListener("krysta:patch-badges",refresh);}return()=>{listeners.delete(fn);if(!listeners.size&&timer){clearInterval(timer);timer=undefined;window.removeEventListener("focus",refresh);window.removeEventListener("krysta:patch-badges",refresh);}};}
const getSnapshot=()=>snapshot;
export function KrystaPatchBadge({game}:{game:LibraryGame}){
 const {i18n}=useTranslation();const pl=i18n.language.startsWith("pl");
 const patches=useSyncExternalStore(subscribe,getSnapshot);
 const members="members" in game&&Array.isArray(game.members)?game.members as LibraryGame[]:[game];
 const patch=patches.find(p=>members.some(m=>m.shop===p.shop&&m.objectId===p.id));
 if(!patch)return null;
 return <span title={patch.title} aria-label={(pl?"Nowy patch: ":"New patch: ")+patch.title} style={{display:"inline-flex",alignItems:"center",gap:4,background:"#245b47",color:"#fff",padding:"3px 6px",borderRadius:4,fontSize:11,fontWeight:600,whiteSpace:"nowrap"}}><ArrowDownIcon size={12}/>{pl?"Nowy patch":"New patch"}</span>;
}
