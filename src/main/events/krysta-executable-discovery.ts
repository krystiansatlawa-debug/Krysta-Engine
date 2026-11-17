import {ipcMain} from "electron";
import type {Download} from "@types";
import fs from "node:fs/promises";
import path from "node:path";
import {downloadsSublevel,gamesSublevel,levelKeys} from "@main/level";
import {getDownloadFolderPath} from "@main/helpers/find-game-installer";
import {isRedistributableDirectory} from "@main/helpers/game-executable-ranking";
import {rankKrystaExecutableSuggestions,chooseKrystaAutomaticExecutable} from "@main/helpers/krysta-executable-ranking";
import {GameExecutables} from "@main/services/game-executables";
import {libraryWriteQueue} from "@main/services/library-sync/library-write-queue";
import {updateGameExecutablePath} from "@main/helpers/update-executable-path";
import {canAutoLinkKrystaExecutable} from "@main/helpers/krysta-executable-autolink";
import {krystaCandidateInstallRoots,krystaCandidateWindowsDrives,krystaExecutableSteamId} from "@main/helpers/krysta-executable-search-roots";
import {getSteamLibraryFolders} from "@main/services/steam";
import {findInstalledSteamApp} from "@main/services/steam-integration/steam-installation-core";
import {scanUbisoft} from "./krysta-ubisoft";

const MAX_FILES=2800,MAX_DEPTH=4,MAX_MS=15000,MAX_SCANNED_ROOTS=32;
const normalize=(v:string)=>v.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g,"");
async function listExe(root:string,budgetMs=MAX_MS):Promise<string[]>{
 const files:string[]=[],pending:[string,number][]=[[root,0]];
 const started=Date.now();let visited=0;
 while(pending.length>0&&visited<MAX_FILES&&Date.now()-started<budgetMs){
  const [dir,depth]=pending.shift()!;
  const entries=await fs.readdir(dir,{withFileTypes:true}).catch(()=>[]);
  for(const entry of entries){
   if(++visited>=MAX_FILES||Date.now()-started>=budgetMs)break;
   if(entry.isSymbolicLink())continue;
   const relative=path.relative(root,path.join(dir,entry.name));
   if(entry.isDirectory()&&depth<MAX_DEPTH&&!isRedistributableDirectory(entry.name)&&!/^\.|^\$|^windowsapps$|^node_modules$/i.test(entry.name)){
    pending.push([path.join(dir,entry.name),depth+1]);
   }else if(entry.isFile()&&/\.exe$/i.test(entry.name))files.push(relative);
  }
 }
 return files;
}
async function detectedRoots(game:{shop:string;objectId:string;title:string;executablePath?:string|null;catalogueGame?:{shop?:string;objectId?:string}|null},download:Download|null){
 const out:string[]=[];
 const add=(root:unknown)=>{if(typeof root==="string"&&path.isAbsolute(root)&&!out.some(v=>v.toLowerCase()===root.toLowerCase()))out.push(root);};
 if(game.executablePath)add(path.dirname(game.executablePath));
 if(download)add(await getDownloadFolderPath(download));
 const steamId=krystaExecutableSteamId(game);
 if(steamId&&/^\d{1,10}$/.test(steamId)){
  const installation=await getSteamLibraryFolders().then(folders=>findInstalledSteamApp(steamId,folders)).catch(()=>null);
  if(installation)add(installation.installDirectory);
 }
 if(process.platform==="win32"){
  const ubi=game.shop==="custom"&&/^(?:ubisoft-|ubi-owned-)/.test(game.objectId)?await scanUbisoft().catch(()=>null):null;
  const matches=ubi?.games.filter(g=>normalize(g.title)===normalize(game.title))??[];
  if(matches.length===1)add(matches[0].path);
  // Only manifests matching this exact game name; never traverse all Epic installs.
  const manifestDir=process.env.ProgramData?path.join(process.env.ProgramData,"Epic","EpicGamesLauncher","Data","Manifests"):null;
  if(manifestDir){
   const entries=(await fs.readdir(manifestDir).catch(()=>[])).filter(n=>n.endsWith(".item")).slice(0,500);
   for(const name of entries){
    try{
     const file=path.join(manifestDir,name),st=await fs.stat(file);
     if(!st.isFile()||st.size>1048576)continue;
     const data=JSON.parse(await fs.readFile(file,"utf8"));
     if(data.bIsIncompleteInstall===true||normalize(data.DisplayName??"")!==normalize(game.title))continue;
     add(data.InstallLocation);
    }catch{}
   }
  }
  // Check mounted drive letters without recursively traversing any drive.
  // Only exact game-title folders below known installation directories are scanned.
  // The original C:/D: assumption skipped games on E:, F: and other drives.
  const mounted=await Promise.all(
   krystaCandidateWindowsDrives(process.env.SystemDrive).map(async drive=>{
    const stat=await fs.lstat(drive+"\\").catch(()=>null);
    return stat?.isDirectory()&&!stat.isSymbolicLink()?drive:null;
   })
  );
  for(const root of krystaCandidateInstallRoots(game.title,mounted.filter((d):d is string=>Boolean(d))))add(root);
 }
 return out;
}
type Candidate={path:string;score:number;highConfidence:boolean};
export async function discoverKrystaGameExecutable(shop:unknown,id:unknown,folder?:unknown){
 if(!["steam","epic","custom"].includes(String(shop))||typeof id!=="string"||!id||id.length>200)throw Error("Invalid game");
 const game=await gamesSublevel.get(levelKeys.game(shop as "steam"|"epic"|"custom",id));
 if(!game||game.isDeleted)throw Error("Game not found");
 if(folder!==undefined&&(typeof folder!=="string"||!path.isAbsolute(folder)))throw Error("Invalid folder");
 // The official executable catalogue helps identify games whose EXE differs from their display title.
 // A slow/offline catalogue endpoint must not block discovery of local files.
 let catalogueTimeout:ReturnType<typeof setTimeout>|undefined;
 try{
  await Promise.race([
   GameExecutables.ensureLoaded().catch(()=>false),
   new Promise<boolean>(resolve=>{
    catalogueTimeout=setTimeout(()=>resolve(false),1500);
    catalogueTimeout.unref?.();
   })
  ]);
 }finally{if(catalogueTimeout)clearTimeout(catalogueTimeout);}
 const download=await downloadsSublevel.get(levelKeys.game(game.shop,game.objectId)).catch(()=>null);
 const roots=folder?[folder]:await detectedRoots(game,download??null);
 const knownSteamId=krystaExecutableSteamId(game);
 const knownExecutables=knownSteamId?GameExecutables.getExecutablesForGame(knownSteamId)??[]:[];
 const found:Candidate[]=[],seen=new Set<string>();
 const scanStarted=Date.now();
 let scannedFolders=0;
 for(const root of roots){
  if(scannedFolders>=MAX_SCANNED_ROOTS)break;
  const remaining=MAX_MS-(Date.now()-scanStarted);
  if(remaining<1000)break;
  if(!path.isAbsolute(root)||path.parse(root).root===root)continue;
  const st=await fs.lstat(root).catch(()=>null);
  if(!st?.isDirectory()||st.isSymbolicLink())continue;
  scannedFolders++;
  const candidates=rankKrystaExecutableSuggestions(await listExe(root,remaining),game.title,knownExecutables);
  for(const item of candidates){
   const file=path.join(root,item.relativePath),key=process.platform==="win32"?file.toLowerCase():file;
   if(seen.has(key))continue;seen.add(key);
   found.push({path:file,score:item.score,highConfidence:item.highConfidence});
  }
 }
 found.sort((a,b)=>b.score-a.score||a.path.length-b.path.length||a.path.localeCompare(b.path));
 const safe=chooseKrystaAutomaticExecutable(found.map(v=>({...v,relativePath:v.path})));
 return {automaticPath:safe,candidates:found.slice(0,10).map(({path,highConfidence})=>({path,highConfidence})),searchedFolders:scannedFolders};
}

/** Auto-link in the background, never replacing a user-selected EXE or official launcher.
 * Rechecks ownership inside the serialized library write queue to avoid racing manual edits.
 */
const automaticLinks=new Map<string,Promise<string|null>>();
const scanWaiters:Array<()=>void>=[];
let activeAutomaticScans=0;
async function withAutoScanSlot<T>(work:()=>Promise<T>):Promise<T>{
 // Prevent automatic background scans from saturating disk I/O when many
 // games are added or imported at once.
 if(activeAutomaticScans>=2){
  // The slot is reserved by the completion handler before this waiter resumes.
  await new Promise<void>(resolve=>scanWaiters.push(resolve));
 }else{
  activeAutomaticScans++;
 }
 try{return await work();}
 finally{
  const next=scanWaiters.shift();
  if(next)next();
  else activeAutomaticScans--;
 }
}
export function autoLinkKrystaGameExecutable(shop:"steam"|"epic"|"custom",id:string):Promise<string|null>{
 if(process.platform!=="win32")return Promise.resolve(null);
 const key=levelKeys.game(shop,id),previous=automaticLinks.get(key);
 if(previous)return previous;
 const task=(async()=>{
  const first=await gamesSublevel.get(key);
  if(!canAutoLinkKrystaExecutable(first))return null;
  const discovered=await withAutoScanSlot(()=>discoverKrystaGameExecutable(shop,id));
  const proposed=discovered.automaticPath;
  if(!proposed)return null;
  const stat=await fs.lstat(proposed).catch(()=>null);
  if(!stat?.isFile()||stat.isSymbolicLink()||!proposed.toLowerCase().endsWith(".exe"))return null;
  return libraryWriteQueue.run(async()=>{
   const current=await gamesSublevel.get(key);
   if(!current||!canAutoLinkKrystaExecutable(current))return null;
   const games=await gamesSublevel.iterator().all();
   if(games.some(([otherKey,other])=>otherKey!==key&&!other.isDeleted&&other.executablePath?.toLowerCase()===proposed.toLowerCase()))return null;
   await gamesSublevel.put(key,updateGameExecutablePath(current,proposed));
   return proposed;
  });
 })().finally(()=>automaticLinks.delete(key));
 automaticLinks.set(key,task);
 return task;
}
ipcMain.handle("krysta:discover-game-exe",(_e,shop:unknown,id:unknown,folder?:unknown)=>discoverKrystaGameExecutable(shop,id,folder));
ipcMain.handle("krysta:auto-link-game-exe",(_e,shop:unknown,id:unknown)=>{
 if((shop!=="steam"&&shop!=="epic"&&shop!=="custom")||typeof id!=="string"||!id||id.length>200)throw Error("Invalid game");
 return autoLinkKrystaGameExecutable(shop,id);
});

