import {ipcMain} from "electron";
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
import {getSteamLibraryFolders} from "@main/services/steam";
import {findInstalledSteamApp} from "@main/services/steam-integration/steam-installation-core";
import {scanUbisoft} from "./krysta-ubisoft";

const MAX_FILES=2800,MAX_DEPTH=4,MAX_MS=12000;
const normalize=(v:string)=>v.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g,"");
const folderNameSafe=(v:string)=>v.trim().replace(/[\\/<>:"|?*]/g,"").replace(/\.+$/,"").slice(0,100);
async function listExe(root:string):Promise<string[]>{
 const files:string[]=[],pending:[string,number][]=[[root,0]];
 const started=Date.now();let visited=0;
 while(pending.length>0&&visited<MAX_FILES&&Date.now()-started<MAX_MS){
  const [dir,depth]=pending.shift()!;
  const entries=await fs.readdir(dir,{withFileTypes:true}).catch(()=>[]);
  for(const entry of entries){
   if(++visited>=MAX_FILES||Date.now()-started>=MAX_MS)break;
   if(entry.isSymbolicLink())continue;
   const relative=path.relative(root,path.join(dir,entry.name));
   if(entry.isDirectory()&&depth<MAX_DEPTH&&!isRedistributableDirectory(entry.name)&&!/^\.|^\$|^windowsapps$|^node_modules$/i.test(entry.name)){
    pending.push([path.join(dir,entry.name),depth+1]);
   }else if(entry.isFile()&&/\.exe$/i.test(entry.name))files.push(relative);
  }
 }
 return files;
}
async function detectedRoots(game:{shop:string;objectId:string;title:string;executablePath?:string|null;catalogueGame?:{shop?:string;objectId?:string}|null},download:{folderName?:string}|null){
 const out:string[]=[];
 const add=(root:unknown)=>{if(typeof root==="string"&&path.isAbsolute(root)&&!out.some(v=>v.toLowerCase()===root.toLowerCase()))out.push(root);};
 if(game.executablePath)add(path.dirname(game.executablePath));
 if(download)add(await getDownloadFolderPath(download as Parameters<typeof getDownloadFolderPath>[0]));
 const steamId=game.shop==="steam"?game.objectId:game.catalogueGame?.shop==="steam"?game.catalogueGame.objectId:null;
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
  const safe=folderNameSafe(game.title);
  if(safe.length>=4){
   for(const drive of ["C:","D:"]){
    for(const dir of ["Games","GOG Games","Epic Games","Ubisoft Games","Rockstar Games"])
     add(path.win32.join(drive+"\\",dir,safe));
   }
  }
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
 await GameExecutables.ensureLoaded().catch(()=>false);
 const download=await downloadsSublevel.get(levelKeys.game(game.shop,game.objectId)).catch(()=>null);
 const roots=folder?[folder]:await detectedRoots(game,download);
 const found:Candidate[]=[],seen=new Set<string>();
 for(const root of roots.slice(0,24)){
  if(!path.isAbsolute(root)||path.parse(root).root===root)continue;
  const st=await fs.lstat(root).catch(()=>null);
  if(!st?.isDirectory()||st.isSymbolicLink())continue;
  const candidates=rankKrystaExecutableSuggestions(await listExe(root),game.title,GameExecutables.getExecutablesForGame(game.objectId)??[]);
  for(const item of candidates){
   const file=path.join(root,item.relativePath),key=process.platform==="win32"?file.toLowerCase():file;
   if(seen.has(key))continue;seen.add(key);
   found.push({path:file,score:item.score,highConfidence:item.highConfidence});
  }
 }
 found.sort((a,b)=>b.score-a.score||a.path.length-b.path.length||a.path.localeCompare(b.path));
 const safe=chooseKrystaAutomaticExecutable(found.map(v=>({...v,relativePath:v.path})));
 return {automaticPath:safe,candidates:found.slice(0,10).map(({path,highConfidence})=>({path,highConfidence})),searchedFolders:roots.length};
}

/** Auto-link in the background, never replacing a user-selected EXE or official launcher.
 * Rechecks ownership inside the serialized library write queue to avoid racing manual edits.
 */
const automaticLinks=new Map<string,Promise<string|null>>();
export function autoLinkKrystaGameExecutable(shop:"steam"|"epic"|"custom",id:string):Promise<string|null>{
 if(process.platform!=="win32")return Promise.resolve(null);
 const key=levelKeys.game(shop,id),previous=automaticLinks.get(key);
 if(previous)return previous;
 const task=(async()=>{
  const first=await gamesSublevel.get(key);
  if(!canAutoLinkKrystaExecutable(first))return null;
  const discovered=await discoverKrystaGameExecutable(shop,id);
  const proposed=discovered.automaticPath;
  if(!proposed)return null;
  const stat=await fs.lstat(proposed).catch(()=>null);
  if(!stat?.isFile()||stat.isSymbolicLink()||!proposed.toLowerCase().endsWith(".exe"))return null;
  return libraryWriteQueue.run(async()=>{
   const current=await gamesSublevel.get(key);
   if(!canAutoLinkKrystaExecutable(current))return null;
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

