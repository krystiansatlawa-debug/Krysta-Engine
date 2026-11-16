import { app, ipcMain, Notification, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gamesSublevel, levelKeys } from "@main/level";
import { getGameNews } from "./krysta-game-news";
import { getSteamLibraryFolders } from "@main/services/steam";
import { readSteamUpdateState } from "@main/services/steam-integration/steam-installation-core";
import type { GameShop, Game } from "@types";

type Watch={shop:GameShop;id:string;enabled:boolean;override?:"on"|"off"|"inherit";installedVersion:string;versionSource?:"product"|"file";seen?:string[];lastChecked?:string;latestTitle?:string;latestVersion?:string;error?:string;steamId?:string;pendingPatch?:string;steamBuildId?:string;updateState?:"required"|"not-reported"|"unknown";updateCheckedAt?:string};
type Store=Record<string,Watch>;
type Settings={enabled:boolean;intervalHours:number;notifications:boolean;startup:boolean};
const defaults:Settings={enabled:false,intervalHours:6,notifications:true,startup:true};
const settingsFile=()=>path.join(app.getPath("userData"),"krysta-game-update-settings.json");
async function readSettings():Promise<Settings>{
 try{return {...defaults,...JSON.parse(await fs.readFile(settingsFile(),"utf8"))};}
 catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return {...defaults};throw e;}
}
function mode(w:Watch|undefined):"on"|"off"|"inherit"{return w?.override??(w?.enabled?"on":"inherit");}
function effective(w:Watch|undefined,settings:Settings){const m=mode(w);return m==="on"||(m==="inherit"&&settings.enabled);}

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
async function smartState(game:Game):Promise<Pick<Watch,"steamBuildId"|"updateState"|"updateCheckedAt">>{
 const unknown={steamBuildId:undefined,updateState:"unknown" as const,updateCheckedAt:new Date().toISOString()};
 if(game.shop!=="steam"||!game.executablePath)return unknown;
 try{
 const found=await readSteamUpdateState(game.objectId,await getSteamLibraryFolders(),game.executablePath);
 return found?{steamBuildId:found.buildId??undefined,updateState:found.updateRequired?"required":"not-reported",updateCheckedAt:unknown.updateCheckedAt}:unknown;
 }catch{return unknown;}
}
async function perform(key:string,force=false){
 const game=await gamesSublevel.get(key);
 if(!game||game.isDeleted||game.shop==="launchbox")return null;
 const snapshot=await serial(async()=>{
  const all=await read(),settings=await readSettings(),old=all[key];
  if(!effective(old,settings)&&!force)return null;
  const w:Watch={...old,shop:game.shop,id:game.objectId,override:mode(old),enabled:effective(old,settings),installedVersion:old?.installedVersion??""};
  all[key]=w;await write(all);return w;
 });
 if(!snapshot)return null;
 const detected=await detectVersion(game.executablePath);
 const smart=await smartState(game);
 try{
 const result=await getGameNews(game.catalogueGame?.shop==="steam"?game.catalogueGame.objectId:snapshot.shop==="steam"?snapshot.id:snapshot.steamId??"",game.title);
 if(!result.appId)throw Error("No verified Steam match");
 const patches=result.items.filter(x=>x.category==="patch").sort((a,b)=>b.date-a.date);
 const latest=patches[0];
 const newItems=snapshot.seen?patches.filter(x=>!snapshot.seen!.includes(x.id)): [];
 return await serial(async()=>{
 const all=await read(),w=all[key],settings=await readSettings();if(!w)return null;
 const enabled=effective(w,settings);
 if(enabled&&snapshot.enabled&&settings.notifications&&Notification.isSupported()){
 if(smart.updateState==="required"&&w.updateState!=="required")new Notification({title:game.title,body:"Steam: aktualizacja wymagana / Update required"}).show();
 const fresh=newItems.filter(x=>!w.seen?.includes(x.id));
 if(fresh.length)new Notification({title:game.title,body:"Nowy patch / New patch: "+fresh[0].title}).show();
 }
 const freshPatch=enabled&&snapshot.enabled&&w.seen?newItems.find(x=>!w.seen?.includes(x.id)):undefined;
 const next={...w,enabled,pendingPatch:enabled?(freshPatch?.title??w.pendingPatch):undefined,...detected,...smart,versionSource:detected.versionSource,steamId:result.appId??undefined,lastChecked:new Date().toISOString(),latestTitle:latest?.title,latestVersion:latest?version(latest.title)??undefined:undefined,seen:[...new Set([...patches.map(x=>x.id),...(w.seen??[])])].slice(0,500),error:undefined};
 all[key]=next;await write(all);return next;
 });
 }catch(e){return serial(async()=>{const all=await read(),w=all[key];if(!w)return null;all[key]={...w,...detected,...smart,versionSource:detected.versionSource,error:String(e)};await write(all);return all[key];});}
}
const inflight=new Map<string,Promise<Watch|null>>();
function check(key:string,force=false){const old=inflight.get(key);if(old)return old;const p=perform(key,force).finally(()=>inflight.delete(key));inflight.set(key,p);return p;}
ipcMain.handle("krysta:game-watch-get",async(_e,shop:unknown,id:unknown)=>{
 const key=keyFor(shop,id),game=await gamesSublevel.get(key);if(!game||game.isDeleted)return null;
 const detected=await detectVersion(game.executablePath);
 const smart=await smartState(game);
 return serial(async()=>{const prior=(await read())[key],settings=await readSettings();return {...(prior??{shop:game.shop,id:game.objectId}),override:mode(prior),enabled:effective(prior,settings),...detected,...smart,versionSource:detected.versionSource};});
});
ipcMain.handle("krysta:game-watch-set",async(_e,shop:GameShop,id:string,override:unknown)=>{
 const key=keyFor(shop,id);if(override!=="inherit"&&override!=="on"&&override!=="off")throw Error("Invalid settings");
 const game=await gamesSublevel.get(key);if(!game||game.isDeleted)throw Error("Add this game to the library first");
 const detected=await detectVersion(game.executablePath);
 const smart=await smartState(game);
 const w=await serial(async()=>{const all=await read(),settings=await readSettings(),old=all[key];const next:Watch={...old,shop,id,override,enabled:override==="on"||(override==="inherit"&&settings.enabled),...detected,...smart,versionSource:detected.versionSource};if(override==="off")next.pendingPatch=undefined;all[key]=next;await write(all);return next;});
 if(w.enabled&&!w.seen)void check(key).catch(()=>{});return w;
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
ipcMain.handle("krysta:game-watch-badges",()=>serial(async()=>{
 const all=await read(),settings=await readSettings();
 return Object.values(all).filter(w=>effective(w,settings)&&(w.pendingPatch||w.updateState==="required")).map(w=>({shop:w.shop,id:w.id,title:w.updateState==="required"?"Steam: update required":w.pendingPatch!,kind:w.updateState==="required"?"required":"patch"}));
}));
ipcMain.handle("krysta:game-watch-dismiss",async(_e,shop:unknown,id:unknown)=>serial(async()=>{
 const key=keyFor(shop,id),all=await read();
 if(all[key]){all[key]={...all[key],pendingPatch:undefined};await write(all);}
}));
let scanning=false,lastScan=0,lastFinished:string|null=null,lastError:string|null=null;
async function scan(){
 if(scanning)return;scanning=true;lastScan=Date.now();lastError=null;
 try{
  const entries=await gamesSublevel.iterator().all();
  const all=await serial(read);
  for(const [key,game] of entries){
   const settings=await serial(readSettings);
   if(game.isDeleted||game.shop==="launchbox"||!effective(all[key],settings))continue;
   await check(key);
   await new Promise(resolve=>setTimeout(resolve,350));
  }
  lastFinished=new Date().toISOString();
 }catch(e){lastError=String(e);}
 finally{scanning=false;}
}
const status=async()=>({...await serial(readSettings),scanning,lastFinished,lastError});
ipcMain.handle("krysta:game-watch-settings",status);
ipcMain.handle("krysta:game-watch-settings-set",async(_e,value:unknown)=>{
 if(!value||typeof value!=="object")throw Error("Invalid settings");
 const v=value as Settings;
 if(typeof v.enabled!=="boolean"||typeof v.notifications!=="boolean"||typeof v.startup!=="boolean"||![1,3,6,12,24].includes(v.intervalHours))throw Error("Invalid settings");
 await serial(async()=>{const old=await readSettings();await fs.writeFile(settingsFile()+".tmp",JSON.stringify({enabled:v.enabled,intervalHours:v.intervalHours,notifications:v.notifications,startup:v.startup}),{mode:0o600});await fs.rename(settingsFile()+".tmp",settingsFile());if(v.enabled&&!old.enabled)lastScan=0;});
 if(v.enabled&&lastScan===0)void scan();return status();
});
ipcMain.handle("krysta:game-watch-scan",async()=>{void scan();return status();});
let timer:ReturnType<typeof setInterval>|undefined;
void app.whenReady().then(()=>{
 lastScan=Date.now();
 setTimeout(()=>void serial(readSettings).then(v=>{if(v.startup)void scan();}).catch(()=>{}),60000);
 timer=setInterval(()=>void serial(readSettings).then(v=>{if(Date.now()-lastScan>=v.intervalHours*3600000)void scan();}).catch(()=>{}),60000);
});
app.on("before-quit",()=>{if(timer)clearInterval(timer);});
