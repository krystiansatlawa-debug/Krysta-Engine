import { ipcMain, net } from "electron";

type News = { id: string; title: string; date: number; contents: string; url: string; author: string; category: "patch" | "news" };
// Normalize display-title decorations only, preserving edition and sequel identities.
export function normalizeNewsTitle(value:string){
 return value.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g,"")
  .replace(/\((?:tm|r|c)\)/g,"").replace(/[™®©]/g,"")
  .replace(/[^a-z0-9]/g,"");
}
function category(x:{title:string;tags?:unknown}):"patch"|"news" {
  const tags=Array.isArray(x.tags)?x.tags.map(t=>String(t).toLowerCase()):[];
  if(tags.some(t=>/^(patchnotes|patch_notes|patch-notes|hotfix)$/.test(t))) return "patch";
  const title=x.title;
  if(/\b(patch notes|release notes|changelog|hotfix(?:es)?|bug fixes|maintenance patch|patch\s+v?\d|(?:game |title )update\s+v?\d|version\s+v?\d+(?:\.\d+)+|update\s+v?\d+(?:\.\d+)+)\b|lista zmian|poprawki błędów|aktualizacja\s+\d/i.test(title)) return "patch";
  return "news";
}
export async function getGameNews(id: unknown, title: unknown) {
  let appId = typeof id === "string" && /^\d{1,10}$/.test(id) ? id : "";
  if (!appId && typeof title === "string" && title.trim()) {
    const q = new URL("https://store.steampowered.com/api/storesearch/");
    q.searchParams.set("term", title.slice(0,200)); q.searchParams.set("l","english"); q.searchParams.set("cc","US");
    const res = await net.fetch(q.toString(), {signal:AbortSignal.timeout(15000)});
    if(!res.ok) throw new Error("Steam search unavailable");
    const data = await res.json();
    const matches = (Array.isArray(data.items) ? data.items : []).filter((g:{name?:string;id?:number}) => typeof g.name==="string" && normalizeNewsTitle(g.name)===normalizeNewsTitle(title));
    const match = matches.length===1?matches[0]:undefined;
    if(match && /^\d{1,10}$/.test(String(match.id))) appId=String(match.id);
  }
  if(!appId) return {appId:null,items:[] as News[]};
  const url = new URL("https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/");
  url.searchParams.set("appid",appId); url.searchParams.set("count","100"); url.searchParams.set("maxlength","0"); url.searchParams.set("feeds","steam_community_announcements");
  const res=await net.fetch(url.toString(),{signal:AbortSignal.timeout(20000)});
  if(!res.ok) throw new Error("Steam news unavailable");
  const data=await res.json();
  const raw=data?.appnews?.newsitems;
  if(!Array.isArray(raw)) throw new Error("Invalid news response");
  const items:News[]=raw.filter((x:any)=>typeof x.title==="string" && typeof x.contents==="string").map((x:any)=>({id:String(x.gid),title:x.title,date:Number(x.date)||0,contents:x.contents.slice(0,60000),url:typeof x.url==="string"?x.url:"",author:String(x.author||""),category:category(x)}));
  return {appId,items};
}
ipcMain.handle("krysta:game-news",(_event,id:unknown,title:unknown)=>getGameNews(id,title));

 
// Optional local Google Cloud Translation key; never included in the installer.
const translations = new Map<string, {title:string;content:string}>();
let translationQueue: Promise<unknown> = Promise.resolve();
ipcMain.handle("krysta:news-translate",(_event,title:unknown,content:unknown)=>{
 const key=process.env.KRYSTA_TRANSLATION_API_KEY?.trim();
 if(!key)return null;
 if(typeof title!=="string"||typeof content!=="string"||title.length>1000||content.length>60000)return null;
 const cacheKey=JSON.stringify([title,content]);
 const cached=translations.get(cacheKey);
 if(cached)return cached;
 const task=translationQueue.then(async()=>{
  const previous=translations.get(cacheKey);if(previous)return previous;
  const chunks=content.match(/[\s\S]{1,3500}/gu)??[];
  const values=[title,...chunks],out:string[]=[];
  for(let i=0;i<values.length;i+=4){
   const q=values.slice(i,i+4);
   const response=await net.fetch("https://translation.googleapis.com/language/translate/v2",{
    method:"POST",headers:{"Content-Type":"application/json","X-goog-api-key":key},
    body:JSON.stringify({q,target:"pl",format:"text"}),signal:AbortSignal.timeout(20000),redirect:"error"
   });
   if(!response.ok)throw Error("Translation unavailable");
   const data=await response.json(),items=data?.data?.translations;
   if(!Array.isArray(items)||items.length!==q.length||items.some(x=>typeof x?.translatedText!=="string"))throw Error("Invalid translation");
   out.push(...items.map(x=>x.translatedText));
  }
  const result={title:out[0],content:out.slice(1).join("")};
  if(translations.size>=64)translations.delete(translations.keys().next().value!);
  translations.set(cacheKey,result);return result;
 }).catch(()=>null);
 translationQueue=task;return task;
});
