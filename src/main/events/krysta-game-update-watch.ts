import { readKrystaSettings, writeKrystaSettings } from "@main/services/krysta-settings-recovery";
import { app, dialog, ipcMain, shell, net } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gamesSublevel, levelKeys } from "@main/level";
import { getEpicGameInstallOptions, startEpicGameUpdate } from "@main/services/epic";
import { scanUbisoft, findUbisoftExecutable } from "./krysta-ubisoft";
import { publishKrystaNotification } from "@main/services/notifications/krysta-notifications";
import { backupBeforeGameUpdate } from "./krysta-cloud";
import { getGameNews } from "./krysta-game-news";
import { getSteamLibraryFolders } from "@main/services/steam";
import { readSteamUpdateState, findInstalledSteamApp, isPathInsideSteamInstallDirectory } from "@main/services/steam-integration/steam-installation-core";
import { hasTrackedGamesRunning } from "@main/services/game-running-state";
import type { GameShop, Game } from "@types";
import { mergePublishedPatches, announcedGamePatchVersion, type PatchAnnouncement } from "../../shared/game-update-patch-history";
import { runBoundedGameUpdateScan } from "../../shared/game-update-scan";

type BuildChange={from:string;to:string;detectedAt:string};
type Watch={gameTitle?:string;installedBuild?:string;installedBuildSource?:"epic"|"gog";platformBuildHistory?:(BuildChange&{source:"epic"|"gog"})[];lastPlatformBuild?:string;lastPlatformSource?:"epic"|"gog";localVersionHistory?:BuildChange[];lastLocalVersion?:string;lastLocalSource?:string;updateProvider?:"steam"|"epic"|"gog";buildHistory?:BuildChange[];lastKnownBuildId?:string;shop:GameShop;id:string;enabled:boolean;override?:"on"|"off"|"inherit";installedVersion:string;versionSource?:"product"|"file"|"epic-manifest"|"version-file"|"gog-manifest";seen?:string[];lastChecked?:string;latestTitle?:string;latestPublishedAt?:string;patchHistory?:PatchAnnouncement[];latestVersion?:string;error?:string;steamId?:string;pendingPatch?:string;steamBuildId?:string;updateState?:"required"|"not-reported"|"unknown";updateCheckedAt?:string};
function recordBuild(w:Watch|undefined,smart:Pick<Watch,"steamBuildId"|"updateState"|"updateCheckedAt">){
 const previous=w?.lastKnownBuildId??w?.steamBuildId;
 const current=smart.steamBuildId;
 const history=w?.buildHistory??[];
 if(!current||!/^\d+$/.test(current))return {lastKnownBuildId:previous,buildHistory:history};
 if(!previous||previous===current||smart.updateState!=="not-reported")return {lastKnownBuildId:smart.updateState==="not-reported"?current:previous,buildHistory:history};
 return {lastKnownBuildId:current,buildHistory:[{from:previous,to:current,detectedAt:smart.updateCheckedAt??new Date().toISOString()},...history].slice(0,1000)};
}
type Store=Record<string,Watch>;
type Settings={enabled:boolean;intervalHours:number;notifications:boolean;startup:boolean;pauseDuringPlay:boolean;autoOpenSteamQueue:boolean;autoDownloadEpic:boolean;backupBeforeUpdate:boolean};
const defaults:Settings={enabled:false,intervalHours:6,notifications:true,startup:true,pauseDuringPlay:true,autoOpenSteamQueue:false,autoDownloadEpic:false,backupBeforeUpdate:true};
async function readSettings():Promise<Settings>{return {...defaults,...await readKrystaSettings<Settings>(app.getPath("userData"),"game-updates")};}
function mode(w:Watch|undefined):"on"|"off"|"inherit"{return w?.override??(w?.enabled?"on":"inherit");}
function effective(w:Watch|undefined,settings:Settings){const m=mode(w);return m==="on"||(m==="inherit"&&settings.enabled);}

const filename=()=>path.join(app.getPath("userData"),"krysta-game-update-watch.json");
let queue:Promise<unknown>=Promise.resolve();
function serial<T>(fn:()=>Promise<T>):Promise<T>{const next=queue.then(fn,fn);queue=next.catch(()=>{});return next;}
async function read():Promise<Store>{try{return JSON.parse(await fs.readFile(filename(),"utf8"));}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return {};throw e;}}
async function write(s:Store){await fs.writeFile(filename()+".tmp",JSON.stringify(s),{mode:0o600});await fs.rename(filename()+".tmp",filename());}
function keyFor(shop:unknown,id:unknown){if((shop!=="steam"&&shop!=="epic"&&shop!=="custom"&&shop!=="launchbox")||typeof id!=="string"||!id||id.length>200)throw Error("Invalid game");return levelKeys.game(shop,id);}
const exec=promisify(execFile);
async function detectExeVersion(exe:string|null|undefined):Promise<{installedVersion:string;versionSource?:"product"|"file"}>{
 const unknown={installedVersion:""};
 if(process.platform!=="win32"||!exe||!path.isAbsolute(exe)||path.extname(exe).toLowerCase()!==".exe")return unknown;
 try{
  const st=await fs.stat(exe);if(!st.isFile())return unknown;
  // The executable path is passed as environment data, never interpolated into PowerShell code.
  const script="$ErrorActionPreference='Stop'; $v=[System.Diagnostics.FileVersionInfo]::GetVersionInfo($env:KRYSTA_VERSION_TARGET); @{product=$v.ProductVersion;file=$v.FileVersion} | ConvertTo-Json -Compress";
  const {stdout}=await exec(path.join(process.env.SystemRoot||"C:\\Windows","System32","WindowsPowerShell","v1.0","powershell.exe"),["-NoLogo","-NoProfile","-NonInteractive","-Command",script],{env:{...process.env,KRYSTA_VERSION_TARGET:exe},windowsHide:true,timeout:10000,maxBuffer:65536});
  const v=JSON.parse(stdout);for(const source of ["product","file"] as const){const raw=v[source];if(typeof raw!=="string")continue;const match=raw.trim().match(/^v?(\d+(?:[.,]\s*\d+){1,4})(?:\s+\([^\r\n]{1,80}\))?$/i);if(!match)continue;const number=match[1].replace(/,\s*/g,".").replace(/\s/g,"");if(!number.split(".").some(n=>Number(n)>0))continue;return {installedVersion:number,versionSource:source};}
 }catch{/* missing or unreadable metadata */}
 return unknown;
}
type LocalVersion={installedVersion:string;versionSource?:"product"|"file"|"epic-manifest"|"version-file"|"gog-manifest"};
async function detectVersion(game:Game):Promise<LocalVersion>{
 let exe=game.executablePath;
 if(process.platform==="win32"&&game.shop==="custom"&&/^(ubi-owned-|ubisoft-)/.test(game.objectId)){
  const local=await scanUbisoft().catch(()=>null);
  const matches=local?.games.filter(g=>game.objectId==="ubisoft-"+g.id||(game.objectId.startsWith("ubi-owned-")&&g.title.toLowerCase()===game.title.toLowerCase()))??[];
  if(matches.length===1&&(!exe||(await fs.stat(exe).catch(()=>null))?.isDirectory()))exe=findUbisoftExecutable(matches[0].path,game.title);
 }
 if(!exe||!path.isAbsolute(exe))return {installedVersion:""};
 const real=await fs.realpath(exe).catch(()=>null);
 if(!real||!(await fs.stat(real).catch(()=>null))?.isFile())return {installedVersion:""};
 const normalize=(p:string)=>process.platform==="win32"?p.toLowerCase():p;
 if(game.shop==="epic"&&process.platform==="win32"&&process.env.ProgramData){
  const manifests=path.join(process.env.ProgramData,"Epic","EpicGamesLauncher","Data","Manifests");
  const entries=await fs.readdir(manifests).catch(()=>[] as string[]);
  const versions=new Set<string>();
  for(const name of entries.filter(n=>n.endsWith(".item")).slice(0,2000)){
   try{
    const f=path.join(manifests,name),st=await fs.lstat(f);
    if(!st.isFile()||st.isSymbolicLink()||st.size>2*1024**2)continue;
    const m=JSON.parse(await fs.readFile(f,"utf8"));
    if(m.bIsIncompleteInstall===true||typeof m.InstallLocation!=="string"||typeof m.LaunchExecutable!=="string"||typeof m.AppVersionString!=="string")continue;
    const root=await fs.realpath(m.InstallLocation),candidate=await fs.realpath(path.resolve(root,m.LaunchExecutable));
    if(normalize(candidate)!==normalize(real))continue;
    const rel=path.relative(root,candidate);
    if(!rel||rel.startsWith("..")||path.isAbsolute(rel))continue;
    const version=m.AppVersionString.trim();
    if(version&&version.length<=160&&!/[\r\n]/.test(version))versions.add(version);
   }catch{/* ignore invalid manifest */}
  }
  if(versions.size===1)return {installedVersion:[...versions][0],versionSource:"epic-manifest"};
 }
 const gog=await gogLocal(game);
 if(gog?.version)return {installedVersion:gog.version,versionSource:"gog-manifest"};
 const direct=await detectExeVersion(real);
 if(direct.installedVersion)return direct;
 // Read only small explicit version files alongside the selected executable.
 const versions=new Set<string>();
 for(const name of ["version.txt","gameversion.txt","game_version.txt","version.json"]){
  try{
   const file=path.join(path.dirname(real),name),st=await fs.lstat(file);
   if(!st.isFile()||st.isSymbolicLink()||st.size>16384)continue;
   const raw=(await fs.readFile(file,"utf8")).replace(/^\uFEFF/,"").trim();
   const value=name.endsWith(".json")?JSON.parse(raw)?.version:raw;
   if(typeof value!=="string")continue;
   const match=value.trim().match(/^(?:version\s*[:=]\s*)?v?(\d+(?:\.\d+){1,4})$/i);
   if(match&&match[1].split(".").some(n=>Number(n)>0))versions.add(match[1]);
  }catch{/* missing or invalid file */}
 }
 if(versions.size===1)return {installedVersion:[...versions][0],versionSource:"version-file"};
 return {installedVersion:""};
}
async function gogLocal(game:Game){
 if(process.platform!=="win32"||game.shop!=="custom"||!game.executablePath||!path.isAbsolute(game.executablePath))return null;
 const exe=await fs.realpath(game.executablePath).catch(()=>null);
 if(!exe||!(await fs.stat(exe).catch(()=>null))?.isFile())return null;
 let dir=path.dirname(exe);
 for(let depth=0;depth<4&&dir!==path.dirname(dir);depth++,dir=path.dirname(dir)){
  const names=(await fs.readdir(dir).catch(()=>[] as string[])).filter(n=>/^goggame-\d{1,20}\.info$/i.test(n));
  const matches:{id:string;build:string;version:string}[]=[];
  for(const name of names.slice(0,32)){
   try{
    const file=path.join(dir,name),st=await fs.lstat(file);
    if(!st.isFile()||st.size>1024**2)continue;
    const m=JSON.parse(await fs.readFile(file,"utf8"));
    const id=name.match(/\d+/)![0];
    if(String(m.gameId)!==id||m.rootGameId&&String(m.rootGameId)!==id||typeof m.buildId!=="string"||!/^\d{1,20}$/.test(m.buildId))continue;
    if(typeof m.name!=="string"||m.name.normalize("NFKC").toLowerCase().trim()!==game.title.normalize("NFKC").toLowerCase().trim())continue;
    matches.push({id,build:m.buildId,version:typeof m.version==="string"?m.version.slice(0,160):""});
   }catch{/* invalid metadata */}
  }
  if(matches.length===1)return matches[0];
  if(matches.length>1)return null;
 }
 return null;
}
function platformHistory(w:Watch|undefined,s:Pick<Watch,"installedBuild"|"installedBuildSource">){
 const history=w?.platformBuildHistory??[];
 if(!s.installedBuild||!s.installedBuildSource)return {platformBuildHistory:history,lastPlatformBuild:w?.lastPlatformBuild,lastPlatformSource:w?.lastPlatformSource};
 const changed=w?.lastPlatformBuild&&w.lastPlatformSource===s.installedBuildSource&&w.lastPlatformBuild!==s.installedBuild;
 return {platformBuildHistory:changed?[{from:w!.lastPlatformBuild!,to:s.installedBuild,source:s.installedBuildSource,detectedAt:new Date().toISOString()},...history].slice(0,1000):history,lastPlatformBuild:s.installedBuild,lastPlatformSource:s.installedBuildSource};
}
function localHistory(w:Watch|undefined,v:LocalVersion){
 const history=w?.localVersionHistory??[];
 if(!v.installedVersion||!v.versionSource)return {localVersionHistory:history,lastLocalVersion:w?.lastLocalVersion,lastLocalSource:w?.lastLocalSource};
 const changed=w?.lastLocalVersion&&w.lastLocalVersion!==v.installedVersion&&w.lastLocalSource===v.versionSource;
 return {localVersionHistory:changed?[{from:w!.lastLocalVersion!,to:v.installedVersion,detectedAt:new Date().toISOString()},...history].slice(0,1000):history,lastLocalVersion:v.installedVersion,lastLocalSource:v.versionSource};
}
async function smartState(game:Game):Promise<Pick<Watch,"steamBuildId"|"updateState"|"updateCheckedAt"|"updateProvider"|"installedBuild"|"installedBuildSource">>{
 const unknown={installedBuild:undefined,installedBuildSource:undefined,updateProvider:undefined,steamBuildId:undefined,updateState:"unknown" as const,updateCheckedAt:new Date().toISOString()};
 // An Epic manifest is sufficient to identify its installed build. A missing
 // manually assigned EXE must not hide a confirmed Epic update.
 if(game.shop==="epic"&&game.epicInstallation){
  try{
   const result=await getEpicGameInstallOptions(game.objectId,AbortSignal.timeout(25000));
   if(result.error)return unknown;
   const installation=game.epicInstallation;
   const matches=result.options.filter(o=>o.artifactId===installation.artifactId&&o.platform===installation.platform&&o.installed&&o.installedVersion&&o.publishedVersion);
   if(matches.length!==1)return unknown;
   const option=matches[0];
   return {...unknown,installedBuild:option.installedVersion??undefined,installedBuildSource:"epic",updateProvider:"epic",updateState:option.installedVersion!==option.publishedVersion?"required":"not-reported"};
  }catch{return unknown;}
 }
 const gog=await gogLocal(game);
 if(gog){
  const local={...unknown,installedBuild:gog.build,installedBuildSource:"gog" as const};
  try{
   const response=await net.fetch("https://content-system.gog.com/products/"+gog.id+"/os/windows/builds?generation=2",{signal:AbortSignal.timeout(12000),redirect:"error"});
   if(!response.ok)return local;
   const data=await response.json();
   if(!Array.isArray(data.items))return local;
   const items=data.items.filter((b:any)=>b.public===true&&b.branch===null&&b.os==="windows"&&String(b.product_id)===gog.id&&typeof b.build_id==="string"&&/^\d+$/.test(b.build_id)&&Number.isFinite(Date.parse(b.date_published))).sort((a:any,b:any)=>Date.parse(b.date_published)-Date.parse(a.date_published));
   if(!items.length)return local;
   if(items[0].build_id===gog.build)return {...local,updateProvider:"gog",updateState:"not-reported"};
   if(items.some((b:any)=>b.build_id===gog.build&&Date.parse(b.date_published)<Date.parse(items[0].date_published)))return {...local,updateProvider:"gog",updateState:"required"};
   return local;
  }catch{return local;}
 }
 if(game.shop!=="steam")return unknown;
 try{
 const found=await readSteamUpdateState(game.objectId,await getSteamLibraryFolders(),game.executablePath);
 return found?{updateProvider:"steam",steamBuildId:found.buildId??undefined,updateState:found.updateRequired?"required":"not-reported",updateCheckedAt:unknown.updateCheckedAt}:unknown;
 }catch{return unknown;}
}
async function perform(key:string,force=false){
 const game=await gamesSublevel.get(key);
 if(!game||game.isDeleted||game.shop==="launchbox")return null;
 const snapshot=await serial(async()=>{
  const all=await read(),settings=await readSettings(),old=all[key];
  if(!effective(old,settings)&&!force)return null;
  const w:Watch={...old,gameTitle:game.title,shop:game.shop,id:game.objectId,override:mode(old),enabled:effective(old,settings),installedVersion:old?.installedVersion??""};
  all[key]=w;await write(all);return w;
 });
 if(!snapshot)return null;
 const [detected,smart]=await Promise.all([detectVersion(game),smartState(game)]);
 // Provider status and Steam news are separate. Failed news requests must not
 // invalidate a confirmed update from a local launcher.
 let news:Awaited<ReturnType<typeof getGameNews>>|null=null;
 let newsError:string|undefined;
 try{
  const response=await getGameNews(game.catalogueGame?.shop==="steam"?game.catalogueGame.objectId:snapshot.shop==="steam"?snapshot.id:snapshot.steamId??"",game.title,true);
  if(response.appId)news=response;
 }catch(error){newsError="Steam patch feed: "+String(error).slice(0,220);}
 const patches=news?.items.filter(x=>x.category==="patch").sort((a,b)=>b.date-a.date)??[];
 const latest=patches[0];
 const newItems=snapshot.seen?patches.filter(x=>!snapshot.seen!.includes(x.id)):[];
 return serial(async()=>{
  const all=await read(),previous=all[key],settings=await readSettings();
  if(!previous)return null;
  const enabled=effective(previous,settings);
  if(enabled&&snapshot.enabled){
   if(smart.updateState==="required"&&previous.updateState!=="required")
    await publishKrystaNotification("KRYSTA_UPDATE",game.title,(smart.updateProvider==="gog"?"GOG":game.shop==="epic"?"Epic Games":"Steam")+": aktualizacja wymagana / Update required",settings.notifications);
   const fresh=newItems.filter(x=>!previous.seen?.includes(x.id));
   if(fresh.length)await publishKrystaNotification("KRYSTA_PATCH",game.title,"Nowy patch / New patch: "+fresh[0].title,settings.notifications);
  }
  const freshPatch=enabled&&snapshot.enabled&&previous.seen?newItems.find(x=>!previous.seen?.includes(x.id)):undefined;
  const next:Watch={
   ...previous,enabled,pendingPatch:enabled?(freshPatch?.title??previous.pendingPatch):undefined,
   ...detected,...smart,
   ...recordBuild(previous,smart),...platformHistory(previous,smart),...localHistory(previous,detected),
   versionSource:detected.versionSource,
   ...(news?{
    steamId:news.appId??undefined,
    lastChecked:new Date().toISOString(),
    latestTitle:latest?.title??previous.latestTitle,
    latestPublishedAt:latest?.date?new Date(latest.date*1000).toISOString():previous.latestPublishedAt,
    latestVersion:latest?announcedGamePatchVersion(latest.title)??undefined:previous.latestVersion,
    patchHistory:mergePublishedPatches(previous.patchHistory,patches),
    seen:[...new Set([...patches.map(x=>x.id),...(previous.seen??[])])].slice(0,500)
   }:{}),
   error:newsError,
  };
  all[key]=next;await write(all);return next;
 });

}
const inflight=new Map<string,Promise<Watch|null>>();
function check(key:string,force=false){const old=inflight.get(key);if(old)return old;const p=perform(key,force).finally(()=>inflight.delete(key));inflight.set(key,p);return p;}
ipcMain.handle("krysta:game-watch-get",async(_e,shop:unknown,id:unknown)=>{
 const key=keyFor(shop,id),game=await gamesSublevel.get(key);if(!game||game.isDeleted)return null;
 // Show the local version without waiting for provider or news network calls.
 const detected=await detectVersion(game);
 return serial(async()=>{
  const all=await read(),prior=all[key],settings=await readSettings();
  const local:Watch={...prior,gameTitle:game.title,shop:game.shop,id:game.objectId,override:mode(prior),enabled:effective(prior,settings),...detected,...localHistory(prior,detected),versionSource:detected.versionSource};
  if(game.shop!=="launchbox"){
   all[key]=local;await write(all);
  }
  return local;
 });
});
ipcMain.handle("krysta:game-watch-set",async(_e,shop:GameShop,id:string,override:unknown)=>{
 const key=keyFor(shop,id);if(override!=="inherit"&&override!=="on"&&override!=="off")throw Error("Invalid settings");
 const game=await gamesSublevel.get(key);if(!game||game.isDeleted)throw Error("Add this game to the library first");
 const detected=await detectVersion(game);
 const smart=await smartState(game);
 const w=await serial(async()=>{const all=await read(),settings=await readSettings(),old=all[key];const next:Watch={...old,gameTitle:game.title,shop,id,override,enabled:override==="on"||(override==="inherit"&&settings.enabled),...detected,...smart,...recordBuild(old,smart),...platformHistory(old,smart),...localHistory(old,detected),versionSource:detected.versionSource};if(override==="off")next.pendingPatch=undefined;all[key]=next;await write(all);return next;});
 if(w.enabled&&!w.seen)void check(key).catch(()=>{});return w;
});
ipcMain.handle("krysta:game-watch-check",(_e,shop:unknown,id:unknown)=>check(keyFor(shop,id),true));
ipcMain.handle("krysta:game-watch-open-client",async(_e,shop:unknown,id:unknown)=>{
 const key=keyFor(shop,id),game=await gamesSublevel.get(key);
 if(!game||game.isDeleted)throw Error("Game not in library");
 if((await serial(readSettings)).pauseDuringPlay&&hasTrackedGamesRunning())throw Error("Zamknij uruchomione gry przed przejściem do aktualizacji / Close running games before opening updates");
 if(game.shop==="steam"&&/^\d+$/.test(game.objectId)){
  const state=await smartState(game);
  if(state.updateState==="required"){
   const settings=await serial(readSettings);
   try{await protectUpdate(game,settings,true);}catch(e){
    if(!String(e).includes("KRYSTA_NO_SAVE_FILES"))throw e;
    const answer=await dialog.showMessageBox({type:"warning",title:"Krysta Launcher",message:"Nie wykryto zapisów gry / No save files detected",detail:"Krysta nie mogła znaleźć plików zapisów. Możesz zlecić Steam weryfikację plików tej gry bez kopii zapisów albo anulować. / Krysta could not detect save files. Continue with game-file validation without a backup or cancel.",buttons:["Anuluj / Cancel","Weryfikuj bez kopii / Verify without backup"],defaultId:0,cancelId:0,noLink:true});
    if(answer.response!==1)throw Error("Anulowano weryfikację gry / Game validation canceled");
   }
   if(hasTrackedGamesRunning())throw Error("Zamknij uruchomione gry / Close running games");
   // Steam's downloads page only opens the queue. Request a validation of the
   // installed app instead: Steam can then download missing/outdated game files.
   // Check the installation identity before sending a modifying Steam command.
   const installed=await findInstalledSteamApp(game.objectId,await getSteamLibraryFolders());
   if(!installed||(game.executablePath&&!isPathInsideSteamInstallDirectory(game.executablePath,installed.installDirectory)))
    throw Error("Nie znaleziono potwierdzonej instalacji Steam tej gry / No matching Steam installation");
   return shell.openExternal("steam://validate/"+installed.appId);
  }
  return shell.openExternal("steam://nav/games/details/"+game.objectId);
 }
 if(game.shop==="epic")return shell.openExternal("com.epicgames.launcher://library");
 if(game.shop==="custom"&&/^(ubi-owned-|ubisoft-)/.test(game.objectId))return shell.openExternal("uplay://");
 throw Error("No supported official client");
});
const integrityLocks=new Set<string>();
ipcMain.handle("krysta:game-integrity",async(_e,shop:unknown,id:unknown,action:unknown)=>{
 const key=keyFor(shop,id),game=await gamesSublevel.get(key);
 if(!game||game.isDeleted||game.shop==="launchbox")throw Error("Game not in library");
 if(hasTrackedGamesRunning())throw Error("Close running games first");
 if(integrityLocks.has(key))throw Error("Verification already running");
 integrityLocks.add(key);
 try{
  if(action==="official"){
   if(game.shop==="steam"){
    const installed=await findInstalledSteamApp(game.objectId,await getSteamLibraryFolders());
    if(!installed||game.executablePath&&!isPathInsideSteamInstallDirectory(game.executablePath,installed.installDirectory))throw Error("No matching Steam installation");
    await shell.openExternal("steam://validate/"+installed.appId);
    return {mode:"official",provider:"Steam"};
   }
   if(game.shop==="epic"){await shell.openExternal("com.epicgames.launcher://library");return {mode:"manual",provider:"Epic Games"};}
   if(game.shop==="custom"&&/^(ubi-owned-|ubisoft-)/.test(game.objectId)){await shell.openExternal("uplay://");return {mode:"manual",provider:"Ubisoft Connect"};}
   throw Error("Official verification unavailable");
  }
  if(action!=="local")throw Error("Invalid verification action");
  if(!game.executablePath||!path.isAbsolute(game.executablePath))throw Error("Game executable not configured");
  const file=await fs.realpath(game.executablePath);
  const before=await fs.stat(file);
  if(!before.isFile()||before.size===0||before.size>8*1024**3)throw Error("Invalid executable");
  const hash=createHash("sha256");
  for await(const chunk of createReadStream(file)){
   if(hasTrackedGamesRunning())throw Error("Verification cancelled: game running");
   hash.update(chunk);
  }
  const after=await fs.stat(file);
  if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ino!==after.ino)throw Error("File changed during verification");
  return {mode:"local",sha256:hash.digest("hex"),size:after.size};
 }finally{integrityLocks.delete(key);}
});
ipcMain.handle("krysta:game-watch-badges",()=>serial(async()=>{
 const all=await read(),settings=await readSettings();
 const badges:{shop:GameShop;id:string;gameTitle:string;title:string;kind:"required"|"patch";downloadPercent:number|null}[]=[];
 let steamFolders:Awaited<ReturnType<typeof getSteamLibraryFolders>>|undefined;
 for(const w of Object.values(all)){
  if(!effective(w,settings)||(!w.pendingPatch&&w.updateState!=="required"))continue;
  const game=await gamesSublevel.get(keyFor(w.shop,w.id));
  if(!game||game.isDeleted)continue;
  let downloadPercent:number|null=null;
  let required=w.updateState==="required";
  if(required&&game.shop==="steam"){
   try{
    steamFolders??=await getSteamLibraryFolders();
    const live=await readSteamUpdateState(game.objectId,steamFolders,game.executablePath);
    if(live){required=live.updateRequired;downloadPercent=live.downloadPercent;}
   }catch{/* retain last checked status when local state cannot be read */}
  }
  if(!required&&!w.pendingPatch)continue;
  badges.push({shop:w.shop,id:w.id,gameTitle:game.title,title:required?(w.updateProvider==="gog"?"GOG: update required":game.shop==="epic"?"Epic Games: update required":"Steam: update required"):w.pendingPatch!,kind:required?"required":"patch",downloadPercent});
 }
 return badges;
}));
ipcMain.handle("krysta:game-watch-history",()=>serial(async()=>{
 const all=await read();
 const rows:(BuildChange&{source:"steam"|"epic"|"gog"|"local";shop:GameShop;id:string;title:string})[]=[];
 for(const w of Object.values(all)){
  const game=await gamesSublevel.get(keyFor(w.shop,w.id)).catch(()=>undefined);
  const title=game?.title??w.gameTitle??w.id;
  for(const entry of w.buildHistory??[])rows.push({...entry,source:"steam",shop:w.shop,id:w.id,title});
  for(const entry of w.platformBuildHistory??[])rows.push({...entry,shop:w.shop,id:w.id,title});
  for(const entry of w.localVersionHistory??[])rows.push({...entry,source:"local",shop:w.shop,id:w.id,title});
 }
 return rows.sort((a,b)=>b.detectedAt.localeCompare(a.detectedAt));
}));
ipcMain.handle("krysta:game-watch-dismiss",async(_e,shop:unknown,id:unknown)=>serial(async()=>{
 const key=keyFor(shop,id),all=await read();
 if(all[key]){all[key]={...all[key],pendingPatch:undefined};await write(all);}
}));
async function protectUpdate(game:Game,settings:Settings,manual=false){
 if(!settings.backupBeforeUpdate)return;
 if(hasTrackedGamesRunning())throw Error("Gra jest uruchomiona / Game is running");
 try{if(!await backupBeforeGameUpdate(game.shop,game.objectId))throw Error("Nie wykonano kopii zapisów / Save backup not completed");}catch(e){if(!(manual&&String(e).includes("KRYSTA_NO_SAVE_FILES")))await publishKrystaNotification("KRYSTA_ERROR",game.title,"Aktualizacja wstrzymana — nie wykonano lokalnej kopii zapisów / Update blocked — local save backup failed",settings.notifications).catch(()=>{});throw e;}
 if(hasTrackedGamesRunning())throw Error("Gra uruchomiona podczas kopii / Game started during backup");
}
const promptedBuilds=new Map<string,string>();
async function offerSteamQueue(){
 const settings=await serial(readSettings);
 if(!settings.autoOpenSteamQueue||hasTrackedGamesRunning())return;
 const all=await serial(read);
 const candidates: {key:string;build:string}[]=[];
 for(const [key,w] of Object.entries(all)){
  if(w.shop!=="steam"||!effective(w,settings)||w.updateState!=="required"){promptedBuilds.delete(key);continue;}
  const game=await gamesSublevel.get(key);
  if(!game||game.isDeleted)continue;
  const live=await smartState(game);
  if(live.updateState!=="required"){if(live.updateState==="not-reported")promptedBuilds.delete(key);continue;}
  const build=live.steamBuildId??"unknown";
  if(promptedBuilds.get(key)!==build){
   await protectUpdate(game,settings);
   candidates.push({key,build});
  }
 }
 if(!candidates.length||hasTrackedGamesRunning()||!(await serial(readSettings)).autoOpenSteamQueue)return;
 await shell.openExternal("steam://open/downloads");
 for(const candidate of candidates)promptedBuilds.set(candidate.key,candidate.build);
}
const epicRequested=new Map<string,string>();
async function offerEpicUpdates(){
 const settings=await serial(readSettings);
 if(!settings.autoDownloadEpic||hasTrackedGamesRunning())return;
 const all=await serial(read);
 for(const [key,w] of Object.entries(all)){
  if(w.shop!=="epic"||!effective(w,settings)||w.updateState!=="required"){epicRequested.delete(key);continue;}
  if(hasTrackedGamesRunning()||!(await serial(readSettings)).autoDownloadEpic)return;
  const game=await gamesSublevel.get(key);
  if(!game||game.isDeleted||!game.epicInstallation||!game.executablePath)continue;
  const installation=game.epicInstallation;
  const result=await getEpicGameInstallOptions(game.objectId,AbortSignal.timeout(25000));
  if(result.error||!result.connectionId)continue;
  const matches=result.options.filter(o=>o.artifactId===installation.artifactId&&o.platform===installation.platform&&o.installed&&o.installedVersion&&o.publishedVersion&&o.installedVersion!==o.publishedVersion);
  if(matches.length!==1)continue;
  const option=matches[0],target=option.publishedVersion;
  if(!target)continue;
  if(epicRequested.get(key)===target)continue;
  const current=await serial(async()=>({settings:await readSettings(),watch:(await read())[key]}));
  if(!current.settings.autoDownloadEpic||!effective(current.watch,current.settings)||hasTrackedGamesRunning())return;
  await protectUpdate(game,current.settings);
  const afterBackup=await serial(async()=>({settings:await readSettings(),watch:(await read())[key]}));
  if(!afterBackup.settings.autoDownloadEpic||!effective(afterBackup.watch,afterBackup.settings)||hasTrackedGamesRunning())return;
  if(afterBackup.settings.backupBeforeUpdate&&!current.settings.backupBeforeUpdate)return;
  const response=await startEpicGameUpdate({epicObjectId:game.objectId,connectionId:result.connectionId,artifactId:option.artifactId,platform:option.platform,preparationId:option.preparationId,addToQueueOnly:false});
  if(response.ok){epicRequested.set(key,target);await publishKrystaNotification("KRYSTA_UPDATE",game.title,"Epic Games: przekazano aktualizację do kolejki / Update submitted",current.settings.notifications);return;}
 }
}
let scanning=false,lastScan=0,lastFinished:string|null=null,lastError:string|null=null;
let scanChecked=0,scanTotal=0,scanRequired=0,scanUnknown=0,scanInterrupted=false;
async function scan(manual=false){
 if(scanning)return;
 if((await serial(readSettings)).pauseDuringPlay&&hasTrackedGamesRunning()){scanInterrupted=true;return;}
 if(scanning)return;scanning=true;lastScan=Date.now();lastError=null;scanInterrupted=false;
 scanChecked=0;scanTotal=0;scanRequired=0;scanUnknown=0;
 try{
  const all=await serial(read),initialSettings=await serial(readSettings);
  if(!manual&&!initialSettings.enabled&&!Object.values(all).some(w=>effective(w,initialSettings)))return;
  const targets:string[]=[];
  for await(const [key,game] of gamesSublevel.iterator()){
   if(game.isDeleted||game.shop==="launchbox")continue;
   if(manual?mode(all[key])!=="off":effective(all[key],initialSettings))targets.push(key);
  }
  scanTotal=targets.length;
  const complete=await runBoundedGameUpdateScan(
   targets,
   async key=>{
    try{
     const result=await check(key,manual);
     if(result?.updateState==="required")scanRequired++;
     if(!result||result.updateState==="unknown"||!result.updateState)scanUnknown++;
    }catch(error){
     scanUnknown++;
     // One broken game's metadata or network feed must not stop the rest.
     if(!lastError)lastError="Błąd sprawdzania jednej z gier / Game check failed: "+String(error).slice(0,160);
    }finally{scanChecked++;}
   },
   async()=>{
    const settings=await serial(readSettings);
    return !(settings.pauseDuringPlay&&hasTrackedGamesRunning());
   },
   3
  );
  if(!complete){scanInterrupted=true;lastScan=0;return;}
  lastFinished=new Date().toISOString();
  try{await offerSteamQueue();}catch(e){lastError="Steam: "+String(e);}
  try{await offerEpicUpdates();}catch(e){lastError=[lastError,"Epic: "+String(e)].filter(Boolean).join(" | ");}
 }catch(e){lastError=String(e);}
 finally{scanning=false;}
}
const status=async()=>({...await serial(readSettings),scanning,scanChecked,scanTotal,scanRequired,scanUnknown,scanInterrupted,lastFinished,lastError,pausedDuringPlay:hasTrackedGamesRunning()});
ipcMain.handle("krysta:game-watch-settings",status);
ipcMain.handle("krysta:game-watch-settings-set",async(_e,value:unknown)=>{
 if(!value||typeof value!=="object")throw Error("Invalid settings");
 const v=value as Settings;
 if(typeof v.enabled!=="boolean"||typeof v.notifications!=="boolean"||typeof v.startup!=="boolean"||(v.backupBeforeUpdate!==undefined&&typeof v.backupBeforeUpdate!=="boolean")||(v.autoDownloadEpic!==undefined&&typeof v.autoDownloadEpic!=="boolean")||(v.autoOpenSteamQueue!==undefined&&typeof v.autoOpenSteamQueue!=="boolean")||(v.pauseDuringPlay!==undefined&&typeof v.pauseDuringPlay!=="boolean")||![1,3,6,12,24].includes(v.intervalHours))throw Error("Invalid settings");
 await serial(async()=>{const old=await readSettings();await writeKrystaSettings(app.getPath("userData"),"game-updates",{enabled:v.enabled,intervalHours:v.intervalHours,notifications:v.notifications,startup:v.startup,pauseDuringPlay:v.pauseDuringPlay??old.pauseDuringPlay,autoOpenSteamQueue:v.autoOpenSteamQueue??old.autoOpenSteamQueue,autoDownloadEpic:v.autoDownloadEpic??old.autoDownloadEpic,backupBeforeUpdate:v.backupBeforeUpdate??old.backupBeforeUpdate});if(v.enabled&&!old.enabled)lastScan=0;});
 if(v.enabled&&lastScan===0)void scan();return status();
});
ipcMain.handle("krysta:game-watch-scan",async()=>{void scan(true);return status();});
let timer:ReturnType<typeof setInterval>|undefined;
void app.whenReady().then(()=>{
 lastScan=Date.now();
 setTimeout(()=>void serial(readSettings).then(v=>{if(v.startup)void scan();}).catch(()=>{}),60000);
 timer=setInterval(()=>void serial(readSettings).then(v=>{if(Date.now()-lastScan>=v.intervalHours*3600000)void scan();}).catch(()=>{}),60000);
});
app.on("before-quit",()=>{if(timer)clearInterval(timer);});
