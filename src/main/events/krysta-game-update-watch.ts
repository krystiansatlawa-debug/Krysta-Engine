import { app, ipcMain, Notification, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gamesSublevel, levelKeys } from "@main/level";
import { getGameNews } from "./krysta-game-news";
import type { GameShop } from "@types";

type Watch={shop:GameShop;id:string;enabled:boolean;installedVersion:string;versionSource?:"product"|"file";seen?:string[];lastChecked?:string;latestTitle?:string;latestVersion?:string;error?:string;steamId?:string};
type Store=Record<string,Watch>;
const filename=()=>path.join(app.getPath("userData"),"krysta-game-update-watch.json");
let queue:Promise<unknown>=Promise.resolve();
function serial<T>(fn:()=>Promise<T>):Promise<T>{const next=queue.then(fn,fn);queue=next.catch(()=>{});return next;}
async function read():Promise<Store>{try{return JSON.parse(await fs.readFile(filename(),"utf8"));}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return {};throw e;}}
async function write(s:Store){await fs.writeFile(filename()+".tmp",JSON.stringify(s),{mode:0o600});await fs.rename(filename()+".tmp",filename());}
function keyFor(shop:unknown,id:unknown){if((shop!=="steam"&&shop!=="epic"&&shop!=="custom"&&shop!=="launchbox")||typeof id!=="string"||!id||id.length>200)throw Error("Invalid game");return levelKeys.game(shop,id);}
function version(title:string){return title.match(/\b(?:patch|hotfix|update|version|v)\s*v?(\d+(?:\.\d+){1,4})\b/i)?.[1]??null;}
const exec=promisify(execFile);
async function detectVersion(exe:string|null|undefined):Promise<{installedVersion:string;versionSource?:"product"|"file"}>{
 const unknown={installedVersion:""};
 if(process.platform!=="win32"||!exe||!path.isAbsolute(exe)||path.extname(exe).toLowerCase()!==".exe")return unknown;
 try{
  const st=await fs.stat(exe);if(!st.isFile())return unknown;
  // The executable path is passed as environment data, never interpolated into PowerShell code.
  const script="$ErrorActionPreference='Stop'; $v=[System.Diagnostics.FileVersionInfo]::GetVersionInfo($env:KRYSTA_VERSION_TARGET); @{product=$v.ProductVersion;file=$v.FileVersion} | ConvertTo-Json -Compress";
  const {stdout}=await exec(path.join(process.env.SystemRoot||"C:\\Windows","System32","WindowsPowerShell","v1.0","powershell.exe"),["-NoLogo","-NoProfile","-NonInteractive","-Command",script],{env:{...process.env,KRYSTA_VERSION_TARGET:exe},windowsHide:true,timeout:10000,maxBuffer:65536});
  const v=JSON.parse(stdout);for(const source of ["product","file"] as const){const raw=v[source];if(typeof raw!=="string")continue;const match=raw.trim().match(/^v?(\d+(?:[.,]\s*\d+){1,3})$/i);if(!match)continue;const number=match[1].replace(/,\s*/g,".").replace(/\s/g,"");if(!number.split(".").some(n=>Number(n)>0))continue;return {installedVersion:number,versionSource:source};}
 }catch{/* missing or unreadable metadata */}
 return unknown;
}
async function perform(key:string,force=false){
 const snapshot=await serial(async()=> (await read())[key]);
 if(!snapshot||(!snapshot.enabled&&!force))return snapshot??null;
 const game=await gamesSublevel.get(key);
 if(!game||game.isDeleted)return snapshot;
 const detected=await detectVersion(game.executablePath);
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
 const next={...w,...detected,versionSource:detected.versionSource,steamId:result.appId??undefined,lastChecked:new Date().toISOString(),latestTitle:latest?.title,latestVersion:latest?version(latest.title)??undefined:undefined,seen:[...new Set([...patches.map(x=>x.id),...(w.seen??[])])].slice(0,500),error:undefined};
 all[key]=next;await write(all);return next;
 });
 }catch(e){return serial(async()=>{const all=await read(),w=all[key];if(!w)return null;all[key]={...w,...detected,versionSource:detected.versionSource,error:String(e)};await write(all);return all[key];});}
}
const inflight=new Map<string,Promise<Watch|null>>();
function check(key:string,force=false){const old=inflight.get(key);if(old)return old;const p=perform(key,force).finally(()=>inflight.delete(key));inflight.set(key,p);return p;}
ipcMain.handle("krysta:game-watch-get",async(_e,shop:unknown,id:unknown)=>{const key=keyFor(shop,id);const game=await gamesSublevel.get(key);if(!game||game.isDeleted)return null;const detected=await detectVersion(game.executablePath);return serial(async()=>{const prior=(await read())[key];return {...(prior??{shop:game.shop,id:game.objectId,enabled:false}),...detected,versionSource:detected.versionSource};});});
ipcMain.handle("krysta:game-watch-set",async(_e,shop:GameShop,id:string,enabled:unknown)=>{
 const key=keyFor(shop,id);if(typeof enabled!=="boolean")throw Error("Invalid settings");
 const game=await gamesSublevel.get(key);if(!game||game.isDeleted)throw Error("Add this game to the library first");
 const detected=await detectVersion(game.executablePath);
 const w=await serial(async()=>{const all=await read();const old=all[key];const next:Watch={...old,shop,id,enabled,...detected,versionSource:detected.versionSource,...(!old?.enabled&&enabled?{seen:undefined}:{})};all[key]=next;await write(all);return next;});
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
