import { app, ipcMain, net } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { isLikelyGamePatchAnnouncement } from "../../shared/game-update-patch-history";

type News = { id: string; title: string; date: number; contents: string; url: string; author: string; category: "patch" | "news" };
// Normalize display-title decorations only, preserving edition and sequel identities.
export function normalizeNewsTitle(value:string){
 return value.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g,"")
  .replace(/\((?:tm|r|c)\)/g,"").replace(/[™®©]/g,"")
  .replace(/[^a-z0-9]/g,"");
}
function category(x:{title:string;tags?:unknown}):"patch"|"news" {
  return isLikelyGamePatchAnnouncement(x.title,x.tags)?"patch":"news";
}
async function fetchGameNews(id: unknown, title: unknown, metadataOnly=false) {
  let appId = typeof id === "string" && /^\d{1,10}$/.test(id) ? id : "";
  if (!appId && typeof title === "string" && title.trim()) {
    const q = new URL("https://store.steampowered.com/api/storesearch/");
    q.searchParams.set("term", title.slice(0,200)); q.searchParams.set("l","english"); q.searchParams.set("cc","US");
    const res = await net.fetch(q.toString(), {signal:AbortSignal.timeout(6000)});
    if(!res.ok) throw new Error("Steam search unavailable");
    const data = await res.json();
    const matches = (Array.isArray(data.items) ? data.items : []).filter((g:{name?:string;id?:number}) => typeof g.name==="string" && normalizeNewsTitle(g.name)===normalizeNewsTitle(title));
    const match = matches.length===1?matches[0]:undefined;
    if(match && /^\d{1,10}$/.test(String(match.id))) appId=String(match.id);
  }
  if(!appId) return {appId:null,items:[] as News[]};
  const url = new URL("https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/");
  url.searchParams.set("appid",appId); url.searchParams.set("count","100"); url.searchParams.set("maxlength",metadataOnly?"1":"0"); url.searchParams.set("feeds","steam_community_announcements");
  const res=await net.fetch(url.toString(),{signal:AbortSignal.timeout(10000)});
  if(!res.ok) throw new Error("Steam news unavailable");
  const data=await res.json();
  const raw=data?.appnews?.newsitems;
  if(!Array.isArray(raw)) throw new Error("Invalid news response");
  const items:News[]=raw.filter((x:any)=>typeof x.title==="string" && typeof x.contents==="string").map((x:any)=>({id:String(x.gid),title:x.title,date:Number(x.date)||0,contents:x.contents.slice(0,60000),url:typeof x.url==="string"?x.url:"",author:String(x.author||""),category:category(x)}));
  return {appId,items};
}
type NewsResult=Awaited<ReturnType<typeof fetchGameNews>>;
const newsRequests=new Map<string,Promise<NewsResult>>();
const metadataCache=new Map<string,{until:number;result:NewsResult}>();
const METADATA_CACHE_MS=3*60_000;
const METADATA_CACHE_MAX=128;
export async function getGameNews(id:unknown,title:unknown,metadataOnly=false,forceRefresh=false):Promise<NewsResult>{
 const key=JSON.stringify([typeof id==="string"?id.slice(0,40):"",typeof title==="string"?title.slice(0,200):"",metadataOnly]);
 // Reading the same game's patch metadata on successive views should not hit
 // Steam again; full article bodies are intentionally never cached here.
 if(metadataOnly&&!forceRefresh){
  const cached=metadataCache.get(key);
  if(cached&&cached.until>Date.now())return cached.result;
  if(cached)metadataCache.delete(key);
 }
 const running=newsRequests.get(key);if(running)return running;
 if(newsRequests.size>=8)throw Error("Too many concurrent news requests");
 const request=fetchGameNews(id,title,metadataOnly).then(result=>{
  if(metadataOnly){
   if(metadataCache.size>=METADATA_CACHE_MAX)
    metadataCache.delete(metadataCache.keys().next().value!);
   metadataCache.set(key,{result,until:Date.now()+METADATA_CACHE_MS});
  }
  return result;
 }).finally(()=>newsRequests.delete(key));
 newsRequests.set(key,request);return request;
}
ipcMain.handle("krysta:game-news",(_event,id:unknown,title:unknown)=>getGameNews(id,title));

 
// Local translation only: article text never leaves the computer.
const translations = new Map<string, {title:string;content:string}>();
let translationQueue: Promise<unknown> = Promise.resolve();
const translationRequests=new Map<string,Promise<{title:string;content:string}|null>>();
async function localTranslate(title:string,content:string):Promise<{title:string;content:string}>{
 const root=path.join(process.resourcesPath,"krysta-translate");
 const python=path.join(root,"python.exe");
 const helper=path.join(root,"krysta-translate.py");
 await fs.access(python);await fs.access(helper);
 const models=path.join(app.getPath("userData"),"translation-models");
 return new Promise((resolve,reject)=>{
  const child=spawn(python,["-I","-X","utf8",helper,models],{windowsHide:true,stdio:["pipe","pipe","pipe"],cwd:root});
  let output="",done=false;
  const finish=(error?:Error,result?:{title:string;content:string})=>{if(done)return;done=true;clearTimeout(timer);if(error)reject(error);else resolve(result!);};
  const timer=setTimeout(()=>{child.kill();finish(Error("Translation timeout"));},300000);
  child.stdout.setEncoding("utf8");
  child.stdout.on("data",chunk=>{output+=chunk;if(output.length>1000000){child.kill();finish(Error("Translation too large"));}});
  child.stderr.resume();
  child.on("error",finish);
  child.stdin.on("error",finish);
  child.on("close",code=>{try{if(code!==0)throw Error("Local translator failed");const data=JSON.parse(output);if(typeof data.title!=="string"||typeof data.content!=="string")throw Error("Invalid local translation");finish(undefined,data);}catch{finish(Error("Translation unavailable"));}});
  child.stdin.end(JSON.stringify({title,content}),"utf8");
 });
}
ipcMain.handle("krysta:news-translate",(_event,title:unknown,content:unknown)=>{
 if(process.platform!=="win32"||typeof title!=="string"||typeof content!=="string"||title.length>1000||content.length>60000)return null;
 const cacheKey=JSON.stringify([title,content]),cached=translations.get(cacheKey);
 if(cached)return cached;
 const running=translationRequests.get(cacheKey);if(running)return running;
 if(translationRequests.size>=3)return null;
 const task=translationQueue.then(async()=>{
  const previous=translations.get(cacheKey);if(previous)return previous;
  const result=await localTranslate(title,content);
  if(translations.size>=16)translations.delete(translations.keys().next().value!);
  translations.set(cacheKey,result);return result;
 }).catch(()=>null).finally(()=>translationRequests.delete(cacheKey));
 translationRequests.set(cacheKey,task);translationQueue=task;return task;
});
