import { app, dialog, ipcMain } from "electron";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { gamesSublevel, levelKeys } from "@main/level";
import { Ludusavi } from "@main/services/ludusavi";
import { gamesPlaytime, onTrackedGamesRunningChange, isTrackedGameKeyRunning } from "@main/services/game-running-state";
import { directCloudIdentity, uploadCloudSnapshot, listRemoteCloudSnapshots, downloadCloudSnapshot } from "./krysta-cloud-accounts";
import type { GameShop } from "@types";

type Provider="google"|"synology"|"local"|"hydra";
type Config={provider:Provider;folder?:string;autoBackup?:boolean;syncBeforeLaunch?:boolean};
type Entry={id:string;createdAt:string;files:number};
const cfgPath=()=>path.join(app.getPath("userData"),"krysta-cloud.json");
async function config():Promise<Config>{try{return JSON.parse(await fs.readFile(cfgPath(),"utf8"));}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return {provider:"hydra"};throw e;}}
async function save(c:Config){const file=cfgPath();await fs.writeFile(file+".tmp",JSON.stringify(c),{mode:0o600});await fs.rename(file+".tmp",file);return c;}
function digest(s:string){return createHash("sha256").update(s).digest("hex");}
function within(root:string,p:string){const rel=path.relative(root,p);return rel===""||(!rel.startsWith(".."+path.sep)&&rel!==".."&&!path.isAbsolute(rel));}
async function gameContext(shop:GameShop,id:string){
 if(typeof shop!=="string"||typeof id!=="string"||!id||id.length>200)throw Error("Invalid game");
 const key=levelKeys.game(shop,id);const game=await gamesSublevel.get(key);
 if(!game||game.isDeleted)throw Error("Game not in library");
 const c=await config();
 if(c.provider==="hydra")throw Error("Select a private cloud provider in settings");
 const provider=c.provider==="google"||c.provider==="synology"?c.provider:null;
 const identity=provider?await directCloudIdentity(provider):null;
 if(!provider&&!c.folder)throw Error("Select a local backup folder in settings");
 const cache=provider?path.join(app.getPath("userData"),"krysta-direct-cache",provider,identity!):null;
 if(cache)await fs.mkdir(cache,{recursive:true});
 const root=await fs.realpath(cache??c.folder!);
 const remoteKey=digest(shop+":"+id);
 const base=path.join(root,"Krysta Cloud",remoteKey);
 return {key,game,base,root,provider,identity,remoteKey};
}
async function safeDirectory(root:string,dir:string){await fs.mkdir(dir,{recursive:true});const actual=await fs.realpath(dir);if(!within(root,actual)||path.relative(root,actual)!==path.relative(root,dir))throw Error("Unsafe cloud directory");return actual;}
async function discover(shop:GameShop,id:string){
 const data=await Ludusavi.getBackupPreview(shop,id);
 const paths=Object.values(data?.games??{}).flatMap(g=>Object.keys(g.files??{}));
 const files:string[]=[];
 for(const p of [...new Set(paths)]){if(!path.isAbsolute(p))continue;const info=await fs.lstat(p).catch(()=>null);if(info?.isFile()&&!info.isSymbolicLink())files.push(await fs.realpath(p));}
 return [...new Set(files)];
}
const locks=new Set<string>();
async function locked<T>(key:string,fn:()=>Promise<T>){if(locks.has(key))throw Error("Backup operation already running");locks.add(key);try{return await fn();}finally{locks.delete(key);}}
async function copyVerified(src:string,dst:string){const st=await fs.lstat(src);if(!st.isFile()||st.isSymbolicLink())throw Error("Invalid save file");await fs.copyFile(src,dst,1);const after=await fs.stat(src);if(st.size!==after.size||st.mtimeMs!==after.mtimeMs)throw Error("Save changed during backup");}
ipcMain.handle("krysta:cloud-config",config);
ipcMain.handle("krysta:cloud-provider",async(_e,p:unknown)=>{if(p!=="google"&&p!=="synology"&&p!=="local"&&p!=="hydra")throw Error("Invalid provider");return save({provider:p,autoBackup:false});});
ipcMain.handle("krysta:cloud-folder",async()=>{const c=await config();if(c.provider!=="local")return c;const result=await dialog.showOpenDialog({properties:["openDirectory","createDirectory"]});if(result.canceled||!result.filePaths[0])return c;return save({...c,folder:await fs.realpath(result.filePaths[0])});});
ipcMain.handle("krysta:cloud-list",async(_e,shop:GameShop,id:string)=>{
 const {base,root,provider,identity,remoteKey}=await gameContext(shop,id);await safeDirectory(root,base);
 const list:Entry[]=[];for(const name of await fs.readdir(base)){if(!/^[0-9a-f-]{36}$/.test(name))continue;try{const dir=await fs.realpath(path.join(base,name));if(dir!==path.join(base,name))continue;const m=JSON.parse(await fs.readFile(path.join(dir,"manifest.json"),"utf8"));if(m.id===name&&Array.isArray(m.files)&&typeof m.createdAt==="string")list.push({id:name,createdAt:m.createdAt,files:m.files.length});}catch{continue;}}
 if(provider){const remote=await listRemoteCloudSnapshots(provider,identity!,remoteKey);for(const m of remote){if(!list.some(e=>e.id===m.id))list.push({id:m.id,createdAt:m.createdAt,files:m.files.length});}}
 return list.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
});
async function backupGame(shop:GameShop,id:string,automatic=false,expected?:Config){
 const {key,base,root,provider,identity,remoteKey}=await gameContext(shop,id);
 return locked(key,async()=>{if(isTrackedGameKeyRunning(key))throw Error("Close the game before backing up");
 if(automatic){const c=await config();if(!c.autoBackup||c.provider!==expected?.provider||c.folder!==expected?.folder)return false;}
 const files=await discover(shop,id);if(!files.length){if(automatic)return false;throw Error("No save files detected by Ludusavi");}
 if(files.length>5000)throw Error("Too many save files");
 if(files.some(p=>within(root,p)))throw Error("Save files overlap cloud folder");
 const comparison=await compareSaves(base,root,files);
 if(automatic&&comparison.state==="same"&&!provider)return false;
 if(provider&&automatic){const remote=await listRemoteCloudSnapshots(provider,identity!,remoteKey);if(comparison.state==="same"&&remote[0]?.id===comparison.version)return false;}
 if(automatic&&!provider&&(comparison.state==="different"||comparison.state==="unavailable"))throw Error("SAVE_CONFLICT: Local and cloud saves differ or cannot be verified. Open Cloud saves to choose a version.");
 if(!automatic){const answer=await dialog.showMessageBox({type:"question",buttons:["Cancel","Create backup"],defaultId:0,cancelId:0,message:comparison.state==="different"?"Local and cloud saves differ. Keep local saves as a new backup without deleting previous versions? / Zapisy różnią się. Zachować lokalne jako nową kopię?":"Create a copy of "+files.length+" detected save files in your selected cloud folder?"});if(answer.response!==1)return false;}
 if(isTrackedGameKeyRunning(key))throw Error("Game started before backup");
 await safeDirectory(root,base);const uuid=randomUUID(),temp=path.join(base,".pending-"+uuid);await fs.mkdir(temp);
 try{const entries=[];let total=0;for(const [i,p] of files.entries()){const st=await fs.stat(p);total+=st.size;if(total>5*1024**3)throw Error("Backup exceeds 5 GB");const name=String(i);await copyVerified(p,path.join(temp,name));entries.push({name,original:p,size:st.size});}if(isTrackedGameKeyRunning(key))throw Error("Game started during backup");await fs.writeFile(path.join(temp,"manifest.json"),JSON.stringify({id:uuid,createdAt:new Date().toISOString(),kind:automatic?"automatic":"manual",files:entries}));if(provider){const current=await config();if(current.provider!==provider)throw Error("Cloud provider changed");await uploadCloudSnapshot(provider,identity!,remoteKey,uuid,temp,entries.map(e=>e.name));}await fs.rename(temp,path.join(base,uuid));return true;}catch(e){await fs.rm(temp,{recursive:true,force:true});throw e;}
 });
}
ipcMain.handle("krysta:cloud-backup",(_e,shop:GameShop,id:string)=>backupGame(shop,id));

/* Restore only files independently detected for this game on this PC.
 * The remote manifest is never trusted to choose a writable destination. */
async function restoreGame(shop:GameShop,id:string,version:unknown){
 if(typeof version!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(version))throw Error("Invalid backup version");
 const {key,base,root,provider,identity,remoteKey}=await gameContext(shop,id);
 return locked(key,async()=>{
  if(isTrackedGameKeyRunning(key))throw Error("Close the game before restoring");
  await safeDirectory(root,base);
  const dir=path.join(base,version);
  if(provider&&!(await fs.lstat(dir).catch(()=>null))){
   const temp=path.join(base,".pending-"+randomUUID());await fs.mkdir(temp);
   try{await downloadCloudSnapshot(provider,identity!,remoteKey,version,temp);await fs.rename(temp,dir);}catch(e){await fs.rm(temp,{recursive:true,force:true});throw e;}
  }
  if(await fs.realpath(dir)!==dir)throw Error("Unsafe backup directory");
  const manifestPath=path.join(dir,"manifest.json");
  const manifestStat=await fs.lstat(manifestPath);
  if(!manifestStat.isFile()||manifestStat.isSymbolicLink()||manifestStat.size>8*1024**2)throw Error("Invalid backup manifest");
  const m=JSON.parse(await fs.readFile(manifestPath,"utf8"));
  if(m.id!==version||!Array.isArray(m.files)||!m.files.length||m.files.length>5000)throw Error("Invalid backup manifest");
  const current=await discover(shop,id);
  const allowed=new Set(current.map(p=>process.platform==="win32"?p.toLowerCase():p));
  const seen=new Set<string>();
  const files:{src:string;dst:string;size:number}[]=[];
  let total=0;
  for(const entry of m.files){
   if(!entry||typeof entry.original!=="string"||typeof entry.name!=="string"||!/^[0-9]+$/.test(entry.name)||!Number.isSafeInteger(entry.size)||entry.size<0)throw Error("Invalid backup entry");
   const candidate=path.normalize(entry.original);
   const destKey=process.platform==="win32"?candidate.toLowerCase():candidate;
   if(!allowed.has(destKey)||seen.has(destKey)||within(root,candidate))throw Error("Save destination not recognized on this computer. Restore requires matching detected local files.");
   seen.add(destKey);
   const dst=current.find(p=>(process.platform==="win32"?p.toLowerCase():p)===destKey)!;
   const src=path.join(dir,entry.name);
   const st=await fs.lstat(src);
   if(!st.isFile()||st.isSymbolicLink()||st.size!==entry.size||await fs.realpath(src)!==src)throw Error("Backup file missing, incomplete or unsafe");
   total+=st.size;if(total>5*1024**3)throw Error("Backup exceeds 5 GB");
   files.push({src,dst,size:st.size});
  }
  const answer=await dialog.showMessageBox({type:"warning",buttons:["Cancel / Anuluj","Restore / Przywróć"],defaultId:0,cancelId:0,message:"Restore selected save version? / Przywrócić wybraną wersję zapisów?",detail:"Existing save files will be backed up before replacement. Close the game first. / Aktualne pliki zostaną skopiowane przed nadpisaniem. Zamknij grę."});
  if(answer.response!==1)return false;
  if(isTrackedGameKeyRunning(key))throw Error("Close the game before restoring");
  const safetyId=randomUUID(),pending=path.join(base,".pending-"+safetyId);
  await fs.mkdir(pending);
  try{
   const entries=[];
   for(const [i,f] of files.entries()){
    const st=await fs.lstat(f.dst);
    if(!st.isFile()||st.isSymbolicLink()||await fs.realpath(f.dst)!==f.dst)throw Error("Save destination changed");
    const name=String(i);await copyVerified(f.dst,path.join(pending,name));entries.push({name,original:f.dst,size:st.size});
   }
   await fs.writeFile(path.join(pending,"manifest.json"),JSON.stringify({id:safetyId,createdAt:new Date().toISOString(),kind:"before-restore",files:entries}));
   await fs.rename(pending,path.join(base,safetyId));
  }catch(e){await fs.rm(pending,{recursive:true,force:true});throw e;}
  const safety=path.join(base,safetyId);
  const changed:number[]=[];
  async function replace(src:string,dst:string){
   if(await fs.realpath(dst)!==dst)throw Error("Unsafe destination");
   const tmp=path.join(path.dirname(dst),".krysta-restore-"+randomUUID()+".tmp");
   try{await copyVerified(src,tmp);if(await fs.realpath(dst)!==dst)throw Error("Destination changed");await fs.rename(tmp,dst);}
   finally{await fs.rm(tmp,{force:true}).catch(()=>{});}
  }
  try{
   for(const [i,f] of files.entries()){
    if(isTrackedGameKeyRunning(key))throw Error("Game started during restore");
    await replace(f.src,f.dst);changed.push(i);
   }
   return true;
  }catch(e){
   const failures=[];
   for(const i of changed.reverse()){try{await replace(path.join(safety,String(i)),files[i].dst);}catch{failures.push(i);}}
   if(failures.length)throw Error("Restore failed; rollback incomplete. Safety backup: "+safetyId);
   throw e;
  }
 });
}
ipcMain.handle("krysta:cloud-restore",(_e,shop:GameShop,id:string,version:unknown)=>restoreGame(shop,id,version));

type AutoResult={state:"saved"|"skipped"|"error";at:string;message?:string};
const autoResults=new Map<string,AutoResult>();
const pendingAuto=new Map<string,ReturnType<typeof setTimeout>>();
let previousRunning=new Set<string>();
let shuttingDown=false;
ipcMain.handle("krysta:cloud-auto",async(_e,enabled:unknown)=>{
 if(typeof enabled!=="boolean")throw Error("Invalid automatic backup setting");
 const c=await config();
 if(enabled){if(c.provider==="hydra"||(c.provider==="local"&&!c.folder))throw Error("Select a backup destination first");if(c.provider==="google"||c.provider==="synology")await directCloudIdentity(c.provider);}
 if(enabled){const answer=await dialog.showMessageBox({type:"question",buttons:["Anuluj / Cancel","Włącz / Enable"],defaultId:0,cancelId:0,message:"Automatycznie kopiować wykryte zapisy wszystkich obsługiwanych gier do wybranego folderu? / Automatically back up detected saves for all supported games to the selected folder?"});if(answer.response!==1)return c;}
 else{for(const timer of pendingAuto.values())clearTimeout(timer);pendingAuto.clear();}
 return save({...c,autoBackup:enabled});
});
ipcMain.handle("krysta:cloud-auto-status",(_e,shop:GameShop,id:string)=>autoResults.get(levelKeys.game(shop,id))??null);
onTrackedGamesRunningChange(()=>{
 const now=new Set(gamesPlaytime.keys());
 for(const key of now){const pending=pendingAuto.get(key);if(pending){clearTimeout(pending);pendingAuto.delete(key);}}
 for(const key of previousRunning){
  if(now.has(key)||shuttingDown||pendingAuto.has(key))continue;
  const timer=setTimeout(()=>{pendingAuto.delete(key);void (async()=>{
   const c=await config();if(shuttingDown||!c.autoBackup||c.provider==="hydra"||(c.provider==="local"&&!c.folder)||isTrackedGameKeyRunning(key))return;
   const game=await gamesSublevel.get(key);if(!game)return;
   const done=await backupGame(game.shop,game.objectId,true,c);
   autoResults.set(key,{state:done?"saved":"skipped",at:new Date().toISOString()});
  })().catch(e=>{autoResults.set(key,{state:"error",at:new Date().toISOString(),message:String(e)});});},15000);
  pendingAuto.set(key,timer);
 }
 previousRunning=now;
});
app.on("before-quit",()=>{shuttingDown=true;for(const timer of pendingAuto.values())clearTimeout(timer);pendingAuto.clear();});

type Comparison={state:"same"|"different"|"no-backup"|"unavailable";version?:string;createdAt?:string;localFiles:number;cloudFiles:number};
async function fileHash(file:string){const h=createHash("sha256");for await(const chunk of createReadStream(file))h.update(chunk);return h.digest("hex");}
const comparablePath=(p:string)=>process.platform==="win32"?path.normalize(p).toLowerCase():path.normalize(p);
async function compareSaves(base:string,root:string,files:string[]):Promise<Comparison>{
 await safeDirectory(root,base);
 const versions:{id:string;createdAt:string;dir:string;files:unknown[]}[]=[];
 let incomplete=false;
 for(const id of await fs.readdir(base)){
  if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id))continue;
  try{
   const dir=path.join(base,id);if(await fs.realpath(dir)!==dir)throw Error("Unsafe version");
   const mp=path.join(dir,"manifest.json"),s=await fs.lstat(mp);
   if(!s.isFile()||s.isSymbolicLink()||s.size>8*1024**2)throw Error("Invalid manifest");
   const m=JSON.parse(await fs.readFile(mp,"utf8"));
   if(m.id!==id||!Array.isArray(m.files)||!m.files.length||m.files.length>5000||typeof m.createdAt!=="string"||!Number.isFinite(Date.parse(m.createdAt)))throw Error("Invalid version");
   if(m.kind!=="before-restore")versions.push({id,createdAt:m.createdAt,dir,files:m.files});
  }catch{incomplete=true;}
 }
 const latest=versions.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||b.id.localeCompare(a.id))[0];
 const result:Comparison={state:"unavailable",version:latest?.id,createdAt:latest?.createdAt,localFiles:files.length,cloudFiles:latest?.files.length??0};
 if(incomplete)return result;
 if(!latest)return {...result,state:"no-backup"};
 if(!files.length)return result;
 const locals=new Map(files.map(p=>[comparablePath(p),p]));
 let same=locals.size===latest.files.length,total=0;
 const seen=new Set<string>();
 try{
  for(const entry of latest.files){
   const e=entry as {original?:unknown;name?:unknown;size?:unknown};
   if(!e||typeof e.original!=="string"||typeof e.name!=="string"||!/^\d+$/.test(e.name)||typeof e.size!=="number"||!Number.isSafeInteger(e.size)||e.size<0)throw Error("Invalid entry");
   const key=comparablePath(e.original);if(seen.has(key))throw Error("Duplicate destination");seen.add(key);
   const src=path.join(latest.dir,e.name),st=await fs.lstat(src);
   if(!st.isFile()||st.isSymbolicLink()||st.size!==e.size||await fs.realpath(src)!==src)throw Error("Incomplete backup");
   total+=st.size;if(total>5*1024**3)throw Error("Too large");
   const local=locals.get(key);
   if(!local){same=false;continue;}
   const before=await fs.lstat(local);if(!before.isFile()||before.isSymbolicLink()||await fs.realpath(local)!==local)throw Error("Unsafe local file");
   if(before.size!==st.size||await fileHash(local)!==await fileHash(src))same=false;
   const after=await fs.stat(local),remoteAfter=await fs.stat(src);
   if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||st.size!==remoteAfter.size||st.mtimeMs!==remoteAfter.mtimeMs)throw Error("Files changed while comparing");
  }
 }catch{return result;}
 return {...result,state:same?"same":"different"};
}
ipcMain.handle("krysta:cloud-compare",async(_e,shop:GameShop,id:string)=>{
 const {key,base,root}=await gameContext(shop,id);
 return locked(key,async()=>{if(isTrackedGameKeyRunning(key))throw Error("Close the game before comparing saves");const files=await discover(shop,id);return compareSaves(base,root,files);});
});

ipcMain.handle("krysta:cloud-sync-before-launch",async(_e,enabled:unknown)=>{
 if(typeof enabled!=="boolean")throw Error("Invalid sync setting");
 const c=await config();
 if(enabled){if(c.provider!=="google"&&c.provider!=="synology")throw Error("Select a direct cloud provider");await directCloudIdentity(c.provider);}
 return save({...c,syncBeforeLaunch:enabled});
});
const launchSyncs=new Set<string>();
export async function syncKrystaCloudBeforeLaunch(shop:GameShop,id:string):Promise<boolean>{
 const c=await config();
 if(!c.syncBeforeLaunch||(c.provider!=="google"&&c.provider!=="synology")||shop==="launchbox")return true;
 const gameKey=levelKeys.game(shop,id);
 if(launchSyncs.has(gameKey))return false;
 launchSyncs.add(gameKey);
 try{
  const {key,base,root,provider,identity,remoteKey,game}=await gameContext(shop,id);
  if(!provider||!identity)return true;
  if(isTrackedGameKeyRunning(key))return false;
  const latest=await locked(key,async()=>{
   const versions=await listRemoteCloudSnapshots(provider,identity,remoteKey);
   const remote=versions[0];if(!remote)return null;
   const current=await discover(shop,id);
   await safeDirectory(root,base);
   const dir=path.join(base,remote.id);
   if(!(await fs.lstat(dir).catch(()=>null))){
    const temp=path.join(base,".pending-"+randomUUID());await fs.mkdir(temp);
    try{await downloadCloudSnapshot(provider,identity,remoteKey,remote.id,temp);await fs.rename(temp,dir);}catch(e){await fs.rm(temp,{recursive:true,force:true});throw e;}
   }
   if(await fs.realpath(dir)!==dir)throw Error("Unsafe snapshot");
   const local=new Map(current.map(p=>[comparablePath(p),p]));
   let same=local.size===remote.files.length,canRestore=true;
   for(const entry of remote.files){
    const target=local.get(comparablePath(entry.original));
    if(!target){same=false;canRestore=false;continue;}
    const source=path.join(dir,entry.name),st=await fs.lstat(source);
    if(!st.isFile()||st.isSymbolicLink()||st.size!==entry.size||await fs.realpath(source)!==source)throw Error("Incomplete snapshot");
    if(await fileHash(target)!==await fileHash(source))same=false;
   }
   return same?null:{remote,canRestore,title:game.title};
  });
  if(!latest)return true;
  const options=latest.canRestore?["Cancel / Anuluj","Use local / Użyj lokalnych","Restore cloud / Przywróć z chmury"]:["Cancel / Anuluj","Use local / Użyj lokalnych"];
  const answer=await dialog.showMessageBox({type:"warning",buttons:options,defaultId:0,cancelId:0,message:"Krysta Cloud — "+latest.title,detail:"Cloud and local saves differ. / Zapisy w chmurze i lokalne różnią się. "+new Date(latest.remote.createdAt).toLocaleString()+(latest.canRestore?"":"\nNie wykryto zgodnych lokalnych ścieżek; przywracanie niedostępne.")});
  if(answer.response===1)return true;
  if(answer.response!==2||!latest.canRestore)return false;
  const now=await config();
  if(!now.syncBeforeLaunch||now.provider!==provider||await directCloudIdentity(provider)!==identity)return false;
  return await restoreGame(shop,id,latest.remote.id);
 }catch{
  const answer=await dialog.showMessageBox({type:"warning",buttons:["Cancel / Anuluj","Play offline / Graj bez synchronizacji"],defaultId:0,cancelId:0,message:"Krysta Cloud: nie można zweryfikować zapisów / Unable to verify saves"});
  return answer.response===1;
 }finally{launchSyncs.delete(gameKey);}
}
