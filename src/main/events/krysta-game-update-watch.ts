import { app, ipcMain, Notification, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { gamesSublevel, levelKeys } from "@main/level";
import { getGameNews } from "./krysta-game-news";
import type { GameShop } from "@types";

type Watch={shop:GameShop;id:string;enabled:boolean;installedVersion:string;seen?:string[];lastChecked?:string;latestTitle?:string;latestVersion?:string;error?:string;steamId?:string};
type Store=Record<string,Watch>;
const filename=()=>path.join(app.getPath("userData"),"krysta-game-update-watch.json");
let queue:Promise<unknown>=Promise.resolve();
function serial<T>(fn:()=>Promise<T>):Promise<T>{const next=queue.then(fn,fn);queue=next.catch(()=>{});return next;}
async function read():Promise<Store>{try{return JSON.parse(await fs.readFile(filename(),"utf8"));}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return {};throw e;}}
async function write(s:Store){await fs.writeFile(filename()+".tmp",JSON.stringify(s),{mode:0o600});await fs.rename(filename()+".tmp",filename());}
function keyFor(shop:unknown,id:unknown){if((shop!=="steam"&&shop!=="epic"&&shop!=="custom"&&shop!=="launchbox")||typeof id!=="string"||!id||id.length>200)throw Error("Invalid game");return levelKeys.game(shop,id);}
function version(title:string){return title.match(/\b(?:patch|hotfix|update|version|v)\s*v?(\d+(?:\.\d+){1,4})\b/i)?.[1]??null;}
async function perform(key:string,force=false){
 const snapshot=await serial(async()=> (await read())[key]);
 if(!snapshot||(!snapshot.enabled&&!force))return snapshot??null;
 const game=await gamesSublevel.get(key);
 if(!game||game.isDeleted)return snapshot;
 try{
 const result=await getGameNews(snapshot.shop==="steam"?snapshot.id:snapshot.steamId??"",game.title);
 if(!result.appId)throw Error("No verified Steam match");
 const patches=result.items.filter(x=>x.category==="patch").sort((a,b)=>b.date-a.date);
 const latest=patches[0];
 const newItems=snapshot.seen?patches.filter(x=>!snapshot.seen!.includes(x.id)): [];
 return await serial(async()=>{
 const all=await read(),w=all[key];if(!w)return null;
 if(w.enabled&&snapshot.enabled&&newItems.length&&Notification.isSupported()){
 const fresh=newItems.filter(x=>!w.seen?.includes(x.id));
 if(fresh.length)new Notification({title:game.title,body:"Nowy patch / New patch: "+fresh[0].title}).show();
 }
 const next={...w,steamId:result.appId??undefined,lastChecked:new Date().toISOString(),latestTitle:latest?.title,latestVersion:latest?version(latest.title)??undefined:undefined,seen:[...new Set([...patches.map(x=>x.id),...(w.seen??[])])].slice(0,500),error:undefined};
 all[key]=next;await write(all);return next;
 });
 }catch(e){return serial(async()=>{const all=await read(),w=all[key];if(!w)return null;all[key]={...w,error:String(e)};await write(all);return all[key];});}
}
const inflight=new Map<string,Promise<Watch|null>>();
function check(key:string,force=false){const old=inflight.get(key);if(old)return old;const p=perform(key,force).finally(()=>inflight.delete(key));inflight.set(key,p);return p;}
ipcMain.handle("krysta:game-watch-get",async(_e,shop:unknown,id:unknown)=>{const key=keyFor(shop,id);return serial(async()=> (await read())[key]??null);});
ipcMain.handle("krysta:game-watch-set",async(_e,shop:GameShop,id:string,enabled:unknown,installed:unknown)=>{
 const key=keyFor(shop,id);if(typeof enabled!=="boolean"||typeof installed!=="string"||installed.length>80)throw Error("Invalid settings");
 const game=await gamesSublevel.get(key);if(!game||game.isDeleted)throw Error("Add this game to the library first");
 const w=await serial(async()=>{const all=await read();const old=all[key];const next:Watch={...old,shop,id,enabled,installedVersion:installed.trim(),...(!old?.enabled&&enabled?{seen:undefined}:{})};all[key]=next;await write(all);return next;});
 if(w.enabled&&!w.seen) void check(key).catch(()=>{});return w;
});
ipcMain.handle("krysta:game-watch-check",(_e,shop:unknown,id:unknown)=>check(keyFor(shop,id),true));
ipcMain.handle("krysta:game-watch-open-client",async(_e,shop:unknown,id:unknown)=>{
 const key=keyFor(shop,id),game=await gamesSublevel.get(key);
 if(!game||game.isDeleted)throw Error("Game not in library");
 if(game.shop==="steam"&&/^\d+$/.test(game.objectId))return shell.openExternal("steam://nav/games/details/"+game.objectId);
 if(game.shop==="epic")return shell.openExternal("com.epicgames.launcher://library");
 if(game.shop==="custom"&&/^(ubi-owned-|ubisoft-)/.test(game.objectId))return shell.openExternal("uplay://");
 throw Error("No supported official client");
});
let scanning=false;
async function scan(){if(scanning)return;scanning=true;try{const all=await serial(read);for(const [key,w] of Object.entries(all)){if(w.enabled)await check(key);}}finally{scanning=false;}}
void app.whenReady().then(()=>{setTimeout(()=>void scan().catch(()=>{}),60000);setInterval(()=>void scan().catch(()=>{}),6*60*60*1000);});
