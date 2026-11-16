import { ipcMain, net, safeStorage, app, dialog } from "electron";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { SevenZip } from "@main/services/7zip";
import { constants, createWriteStream, renameSync, promises as fs } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { gamesSublevel, levelKeys } from "@main/level";
import { findGameRootFromExe, isUnsafePath } from "./helpers/find-game-root";
import { join, basename, isAbsolute } from "node:path";
const keyPath=()=>join(app.getPath("userData"),"krysta-nexus.enc");
function key(){try{return safeStorage.decryptString(readFileSync(keyPath()));}catch{return "";}}
async function api(path:string, token=key()){
 if(!token)throw new Error("Nexus account required");
 const res=await net.fetch("https://api.nexusmods.com/v1/"+path,{headers:{apikey:token,"Application-Name":"Krysta Launcher","Application-Version":"1.0"},redirect:"error",signal:AbortSignal.timeout(20000)});
 if(!res.ok)throw new Error("Nexus HTTP "+res.status);
 return res.json();
}
function domain(value:unknown){if(typeof value!=="string"||! /^[a-z0-9_-]{1,100}$/.test(value))throw new Error("Invalid game domain");return value;}
ipcMain.handle("krysta:mods-status",()=>({connected:!!key()}));
ipcMain.handle("krysta:mods-connect",async(_event,token:unknown)=>{
 if(typeof token!=="string"||token.length<10||token.length>500||!safeStorage.isEncryptionAvailable())throw new Error("Invalid key or encryption unavailable");
 const user=await api("users/validate.json",token);
 writeFileSync(keyPath(),safeStorage.encryptString(token),{mode:0o600});
 return {connected:true,name:String(user.name||"Nexus Mods"),premium:!!user.is_premium};
});
ipcMain.handle("krysta:mods-disconnect",()=>{rmSync(keyPath(),{force:true});});
ipcMain.handle("krysta:mods-games",async()=>{
 const games=await api("games.json");
 return (Array.isArray(games)?games:[]).map(g=>({name:String(g.name),domain:String(g.domain_name)}));
});
ipcMain.handle("krysta:mods-list",async(_event,value:unknown,sort:unknown)=>{
 const d=domain(value);
 const endpoint=sort==="latest"?"latest_added":sort==="updated"?"latest_updated":"trending";
 const mods=await api("games/"+d+"/mods/"+endpoint+".json");
 return (Array.isArray(mods)?mods:[]).map(m=>({id:Number(m.mod_id),name:String(m.name),summary:String(m.summary||""),version:String(m.version||""),picture:String(m.picture_url||""),author:String(m.author||"")}));
});
ipcMain.handle("krysta:mods-files",async(_event,value:unknown,id:unknown)=>{
 const d=domain(value);
 if(typeof id!=="number"||!Number.isSafeInteger(id)||id<1)throw new Error("Invalid mod");
 const data=await api("games/"+d+"/mods/"+id+"/files.json");
 return (Array.isArray(data.files)?data.files:[]).map((f:any)=>({id:Number(f.file_id),name:String(f.name),version:String(f.version||"")}));
});

function positive(value:unknown){if(typeof value!=="number"||!Number.isSafeInteger(value)||value<1)throw new Error("Invalid ID");return value;}
ipcMain.handle("krysta:mods-download",async(_event,d:unknown,m:unknown,f:unknown)=>{
 const game=domain(d),mod=positive(m),file=positive(f);
 const data=await api("games/"+game+"/mods/"+mod+"/files/"+file+"/download_link.json");
 const url=new URL(data?.[0]?.URI||"");
 if(url.protocol!=="https:")throw new Error("Invalid download URL");
 const choice=await dialog.showSaveDialog({defaultPath:game+"-"+mod+"-"+file+".zip",filters:[{name:"Mod archive",extensions:["zip","7z","rar"]}]});
 if(choice.canceled||!choice.filePath)return false;
 const response=await net.fetch(url.href,{signal:AbortSignal.timeout(300000)});
 if(!response.ok||!response.body)throw new Error("Download failed");
 const temp=choice.filePath+".krysta-part-"+randomUUID();
 try{
  await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),createWriteStream(temp,{flags:"wx"}));
  await fs.rename(temp,choice.filePath);
 }finally{await fs.rm(temp,{force:true});}
 return true;
});

type Installed = {id:string;name:string;root:string;gameKey?:string;enabled?:boolean;nexus?:{domain:string;modId:number;fileId:number;version:string};files:{path:string;hash:string}[]};
const manifest=()=>join(app.getPath("userData"),"krysta-installed-mods.json");
function records():Installed[]{try{return JSON.parse(readFileSync(manifest(),"utf8"));}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return [];throw e;}}
function save(entries:Installed[]){const target=manifest(),temp=target+".tmp";writeFileSync(temp,JSON.stringify(entries),{mode:0o600});renameSync(temp,target);}
function parts(name:string){const items=name.replace(/\\/g,"/").split("/");if(items.some(v=>!v||v==="."||v===".."||/[<>:"|?*\x00-\x1f]/.test(v)||/[. ]$/.test(v)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(v)))throw new Error("Unsafe archive path");return items;}
async function target(root:string,name:string,create=false){const items=parts(name);let path=root;for(const part of items.slice(0,-1)){path=join(path,part);if(create)await fs.mkdir(path).catch(e=>{if(e.code!=="EEXIST")throw e;});const stat=await fs.lstat(path).catch(e=>{if(e.code==="ENOENT")return null;throw e;});if(stat&&(!stat.isDirectory()||stat.isSymbolicLink()))throw new Error("Unsafe destination");}return join(path,items[items.length-1]);}
async function exists(path:string){try{await fs.lstat(path);return true;}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return false;throw e;}}
const hash=(buffer:Buffer)=>createHash("sha256").update(buffer).digest("hex");
let modifying=false;
async function exclusive<T>(work:()=>Promise<T>){if(modifying)throw new Error("Another mod operation is active");modifying=true;try{return await work();}finally{modifying=false;}}
ipcMain.handle("krysta:mods-installed",()=>records().map(({id,name,root,gameKey,enabled,nexus})=>({id,name,root,gameKey,enabled:enabled!==false,nexus})));
ipcMain.handle("krysta:mods-install-local",(_event,gameKey:unknown)=>exclusive(async()=>{
 const archive=await dialog.showOpenDialog({properties:["openFile"],filters:[{name:"Mod archive",extensions:["zip","7z","rar"]}]});if(archive.canceled)return false;
 const root=await chooseGameRoot(gameKey);if(!root)return false;
 const source=archive.filePaths[0];
 const entries=await SevenZip.listEntries(source);
 if(!entries.length||entries.length>2000||entries.some(e=>e.encrypted||e.size>128*1024*1024)||entries.reduce((n,e)=>n+e.size,0)>1024*1024*1024)throw new Error("Unsupported archive");
 const seen=new Set<string>();
 for(const entry of entries){const name=parts(entry.name).join("/").toLowerCase();if(seen.has(name))throw new Error("Duplicate archive path");seen.add(name);if(await exists(await target(root,entry.name)))throw new Error("Conflict: "+entry.name);}
 const confirm=await dialog.showMessageBox({type:"warning",buttons:["Cancel","Install"],defaultId:0,cancelId:0,message:"Install "+entries.length+" files into "+root+"?",detail:"Only simple archives with paths relative to the game folder are supported. Mods can contain executable code. Install only trusted files."});if(confirm.response!==1)return false;
 const record:Installed={id:randomUUID(),name:basename(source),root,gameKey:typeof gameKey==="string"?gameKey.slice(0,250):undefined,enabled:true,files:[]};
 try{
  for(const entry of entries){const buffer=await SevenZip.readEntry(source,entry.name,Math.max(1,entry.size+1));if(buffer.length!==entry.size)throw new Error("Archive size mismatch");const dest=await target(root,entry.name,true);await fs.writeFile(dest,buffer,{flag:"wx"});record.files.push({path:entry.name,hash:hash(buffer)});}
  save([...records(),record]);
 }catch(e){for(const file of record.files){const dest=await target(root,file.path);if(await exists(dest)&&hash(await fs.readFile(dest))===file.hash)await fs.unlink(dest);}throw e;}
 return true;
}));
ipcMain.handle("krysta:mods-remove",(_event,id:unknown)=>exclusive(async()=>{
 const entries=records(),record=entries.find(e=>e.id===id);if(!record)throw new Error("Unknown mod");
 if(record.enabled===false){await fs.rm(join(app.getPath("userData"),"krysta-disabled-mods",record.id),{recursive:true,force:true});save(entries.filter(e=>e.id!==id));return true;}
 const root=await fs.realpath(record.root);if(root!==record.root)throw new Error("Game directory changed");
 for(const file of record.files){const dest=await target(root,file.path);if(await exists(dest)){const stat=await fs.lstat(dest);if(!stat.isFile()||stat.isSymbolicLink()||hash(await fs.readFile(dest))!==file.hash)throw new Error("Modified file: "+file.path);}}
 const confirm=await dialog.showMessageBox({type:"warning",buttons:["Cancel","Remove"],defaultId:0,cancelId:0,message:"Remove "+record.name+"?"});if(confirm.response!==1)return false;
 for(const file of record.files){const dest=await target(root,file.path);if(await exists(dest))await fs.unlink(dest);}
 save(entries.filter(e=>e.id!==id));return true;
}));

ipcMain.handle("krysta:mods-toggle",(_event,id:unknown,enabled:unknown)=>exclusive(async()=>{
 if(typeof id!=="string"||typeof enabled!=="boolean")throw new Error("Invalid mod state");
 const entries=records(),record=entries.find(e=>e.id===id);
 if(!record||!/^[0-9a-f-]{36}$/i.test(record.id))throw new Error("Unknown mod");
 if((record.enabled!==false)===enabled)return true;
 const root=await fs.realpath(record.root);if(root!==record.root)throw new Error("Game directory changed");
 const backup=join(app.getPath("userData"),"krysta-disabled-mods",record.id);
 await fs.mkdir(backup,{recursive:true});
 const moved:{from:string;to:string}[]=[];
 for(const file of record.files){
  const source=await target(enabled?backup:root,file.path);
  const destination=await target(enabled?root:backup,file.path);
  const stat=await fs.lstat(source);
  if(!stat.isFile()||stat.isSymbolicLink()||hash(await fs.readFile(source))!==file.hash||await exists(destination))throw new Error("File conflict: "+file.path);
 }
 try{
  for(const file of record.files){
   const from=await target(enabled?backup:root,file.path);
   const to=await target(enabled?root:backup,file.path,true);
   await fs.copyFile(from,to,constants.COPYFILE_EXCL);
   try{await fs.unlink(from);}catch(e){await fs.unlink(to);throw e;}
   moved.push({from,to});
  }
  save(entries.map(e=>e.id===id?{...e,enabled}:e));
 }catch(e){
  for(const {from,to} of moved.reverse()){await fs.copyFile(to,from,constants.COPYFILE_EXCL);await fs.unlink(to);}
  throw e;
 }
 return true;
}));

type NexusFile = {file_id:number;version?:string;name?:string;category_id?:number};
type NexusIdentity = NonNullable<Installed["nexus"]>;
async function fileInfo(d:string,m:number,f:number):Promise<NexusFile>{
 const data=await api("games/"+d+"/mods/"+m+"/files.json");
 const file=(Array.isArray(data.files)?data.files:[]).find((x:NexusFile)=>x.file_id===f);
 if(!file)throw new Error("Nexus file unavailable");
 return file;
}
async function getUpdate(record:Installed){
 const n=record.nexus;if(!n)return null;
 const data=await api("games/"+domain(n.domain)+"/mods/"+positive(n.modId)+"/files.json");
 let id=n.fileId;const seen=new Set<number>();
 while(!seen.has(id)){
  seen.add(id);
  const next=(Array.isArray(data.file_updates)?data.file_updates:[]).filter((x:{old_file_id:number;new_file_id:number})=>x.old_file_id===id);
  if(!next.length)break;
  const candidates=[...new Set<number>(next.map((x:{new_file_id:number})=>positive(x.new_file_id)))];
  if(candidates.length!==1||seen.has(candidates[0]))return null;
  id=candidates[0];
 }
 const file=(Array.isArray(data.files)?data.files:[]).find((x:NexusFile)=>x.file_id===id);
 return id!==n.fileId&&file&&file.category_id!==6&&file.category_id!==7?{id:record.id,fileId:id,version:String(file.version||""),name:String(file.name||record.name)}:null;
}
ipcMain.handle("krysta:mods-updates",async(_event,gameKey:unknown)=>{
 if(typeof gameKey!=="string")throw new Error("Invalid game");
 const results=await Promise.allSettled(records().filter(m=>m.gameKey===gameKey&&m.nexus).map(getUpdate));
 return {updates:results.flatMap(r=>r.status==="fulfilled"&&r.value?[r.value]:[]),failed:results.filter(r=>r.status==="rejected").length};
});
async function downloadArchive(n:NexusIdentity,folder:string){
 const data=await api("games/"+n.domain+"/mods/"+n.modId+"/files/"+n.fileId+"/download_link.json");
 const url=new URL(data?.[0]?.URI||"");
 if(url.protocol!=="https:")throw new Error("Invalid download URL");
 const response=await net.fetch(url.href,{signal:AbortSignal.timeout(300000)});
 if(!response.ok||!response.body)throw new Error("Download failed");
 const path=join(folder,"mod.archive");
 await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),createWriteStream(path,{flags:"wx"}));
 return path;
}
async function stageArchive(source:string,stage:string){
 await fs.mkdir(stage,{recursive:true});
 const entries=await SevenZip.listEntries(source);
 if(!entries.length||entries.length>2000||entries.some(e=>e.encrypted||e.size>128*1024*1024)||entries.reduce((n,e)=>n+e.size,0)>1024*1024*1024)throw new Error("Unsupported archive");
 const seen=new Set<string>();const files:Installed["files"]=[];
 for(const entry of entries){
  const name=parts(entry.name).join("/"),lower=name.toLowerCase();
  if(seen.has(lower))throw new Error("Duplicate archive path");seen.add(lower);
  const buffer=await SevenZip.readEntry(source,entry.name,Math.max(1,entry.size+1));
  if(buffer.length!==entry.size)throw new Error("Archive size mismatch");
  await fs.writeFile(await target(stage,name,true),buffer,{flag:"wx"});
  files.push({path:name,hash:hash(buffer)});
 }
 return files;
}
async function deploy(record:Installed,previous:Installed|undefined,stage:string){
 const all=records(), root=record.root;
 const old=previous?.files??[];
 const oldNames=new Set(old.map(f=>parts(f.path).join("/").toLowerCase()));
 if(previous?.enabled===false)throw new Error("Enable mod before updating");
 for(const file of old){
  const dest=await target(root,file.path);const stat=await fs.lstat(dest);
  if(!stat.isFile()||stat.isSymbolicLink()||hash(await fs.readFile(dest))!==file.hash)throw new Error("Modified file: "+file.path);
 }
 for(const file of record.files){
  const dest=await target(root,file.path);
  if(await exists(dest)&&!oldNames.has(file.path.toLowerCase()))throw new Error("Conflict: "+file.path);
 }
 const backup=join(app.getPath("userData"),"krysta-mod-backups",record.id,randomUUID());
 await fs.mkdir(backup,{recursive:true});
 for(const file of old)await fs.copyFile(await target(root,file.path),await target(backup,file.path,true),constants.COPYFILE_EXCL);
 if(previous)await fs.writeFile(join(backup,".krysta-previous.json"),JSON.stringify(previous),{flag:"wx"});
 const removed:Installed["files"]=[],written:Installed["files"]=[];
 try{
  for(const file of old){await fs.unlink(await target(root,file.path));removed.push(file);}
  for(const file of record.files){await fs.copyFile(await target(stage,file.path),await target(root,file.path,true),constants.COPYFILE_EXCL);written.push(file);}
  save([...all.filter(m=>m.id!==record.id),record]);
 }catch(error){
  for(const file of written){const dest=await target(root,file.path);if(hash(await fs.readFile(dest))===file.hash)await fs.unlink(dest);}
  for(const file of removed)await fs.copyFile(await target(backup,file.path),await target(root,file.path,true),constants.COPYFILE_EXCL);
  throw error;
 }
}
ipcMain.handle("krysta:mods-install-nexus",(_event,d:unknown,m:unknown,f:unknown,gameKey:unknown)=>exclusive(async()=>{
 if(typeof gameKey!=="string"||gameKey.length>250)throw new Error("Invalid game");
 const n={domain:domain(d),modId:positive(m),fileId:positive(f),version:""};
 const info=await fileInfo(n.domain,n.modId,n.fileId);n.version=String(info.version||"");
 if(records().some(x=>x.gameKey===gameKey&&x.nexus?.domain===n.domain&&x.nexus?.modId===n.modId))throw new Error("Mod already installed; use update");
 const root=await chooseGameRoot(gameKey);if(!root)return false;
 if(!await confirmRequirements(n.domain,n.modId,gameKey,root))return false;
 const confirm=await dialog.showMessageBox({type:"warning",buttons:["Cancel","Install"],defaultId:0,cancelId:0,message:"Install "+String(info.name||"mod")+" into "+root+"?",detail:"Only install trusted mods. Simple archives relative to the game folder are supported."});
 if(confirm.response!==1)return false;
 const temp=await fs.mkdtemp(join(app.getPath("temp"),"krysta-mod-"));
 try{
  const stage=join(temp,"stage"),files=await stageArchive(await downloadArchive(n,temp),stage);
  await deploy({id:randomUUID(),name:String(info.name||"Nexus mod"),root,gameKey,enabled:true,nexus:n,files},undefined,stage);
  return true;
 }finally{await fs.rm(temp,{recursive:true,force:true});}
}));
ipcMain.handle("krysta:mods-apply-update",(_event,id:unknown)=>exclusive(async()=>{
 const previous=records().find(m=>m.id===id);
 if(!previous?.nexus||previous.enabled===false)throw new Error("Enable a Nexus-installed mod first");
 const next=await getUpdate(previous);if(!next)return false;
 const root=await fs.realpath(previous.root);if(root!==previous.root)throw new Error("Game directory changed");
 const confirm=await dialog.showMessageBox({type:"warning",buttons:["Cancel","Update"],defaultId:0,cancelId:0,message:"Update "+previous.name+" to "+next.version+"?",detail:"Close the game before updating. Previous mod files will be backed up."});if(confirm.response!==1)return false;
 if(!await confirmRequirements(previous.nexus.domain,previous.nexus.modId,previous.gameKey??"",root))return false;
 const n={...previous.nexus,fileId:next.fileId,version:next.version};
 const temp=await fs.mkdtemp(join(app.getPath("temp"),"krysta-mod-"));
 try{
  const stage=join(temp,"stage"),files=await stageArchive(await downloadArchive(n,temp),stage);
  await deploy({...previous,nexus:n,files},previous,stage);return true;
 }finally{await fs.rm(temp,{recursive:true,force:true});}
}));

type Requirement = {name:string;notes:string;url:string;modId:number;status:"installed"|"disabled"|"missing"|"manual"};
async function requirements(d:string,m:number,gameKey:string,root?:string){
 const game=await api("games/"+domain(d)+".json");
 const gameId=String(game.id);
 if(!/^\d+$/.test(gameId))throw new Error("Unknown Nexus game ID");
 const token=key();if(!token)throw new Error("Nexus account required");
 const result:Requirement[]=[];
 let legacy=true, offset=0, total=0;
 do{
  const response=await net.fetch("https://api.nexusmods.com/v2/graphql",{method:"POST",redirect:"error",signal:AbortSignal.timeout(20000),headers:{apikey:token,"Content-Type":"application/json","Application-Name":"Krysta Launcher","Application-Version":"1.0"},body:JSON.stringify({query:"query Requirements($game: ID!, $mod: ID!, $offset: Int!) { mod(gameId:$game,modId:$mod) { legacyModRequirementsEnabled modRequirements { nexusRequirements(offset:$offset,count:50) { totalCount nodes { gameId modId modName notes url externalRequirement } } dlcRequirements { notes } } } }",variables:{game:gameId,mod:String(positive(m)),offset}})});
  if(!response.ok)throw new Error("Nexus requirements unavailable");
  const data=await response.json(),mod=data?.data?.mod,req=mod?.modRequirements,page=req?.nexusRequirements;
  if(data.errors?.length||!Array.isArray(page?.nodes)||!Array.isArray(req?.dlcRequirements)||!Number.isSafeInteger(page.totalCount))throw new Error("Invalid dependency response");
  legacy=mod.legacyModRequirementsEnabled===true;total=page.totalCount;
  const installed=records().filter(x=>x.gameKey===gameKey&&(!root||x.root===root));
  for(const item of page.nodes){
   const id=Number(item.modId),same=!item.externalRequirement&&String(item.gameId)===gameId&&Number.isSafeInteger(id)&&id>0;
   const found=same?installed.find(x=>x.nexus?.domain===d&&x.nexus.modId===id):undefined;
   result.push({name:String(item.modName||"Requirement"),notes:String(item.notes||""),url:same?"https://www.nexusmods.com/"+d+"/mods/"+id:String(item.url||""),modId:same?id:0,status:!same?"manual":found?(found.enabled===false?"disabled":"installed"):"missing"});
  }
  if(offset===0)for(const dlc of req.dlcRequirements)result.push({name:"DLC / expansion",notes:String(dlc.notes||""),url:"",modId:0,status:"manual"});
  offset+=page.nodes.length;
  if(!page.nodes.length&&offset<total)throw new Error("Incomplete requirements");
 }while(offset<total&&offset<500);
 return {items:result,complete:legacy&&offset>=total};
}
ipcMain.handle("krysta:mods-requirements",(_event,d:unknown,m:unknown,g:unknown)=>{
 if(typeof g!=="string")throw new Error("Invalid game");
 return requirements(domain(d),positive(m),g);
});
async function confirmRequirements(d:string,m:number,g:string,root:string){
 let detail:string;
 try{
  const result=await requirements(d,m,g,root);
  const unresolved=result.items.filter(x=>x.status!=="installed");
  if(!unresolved.length&&result.complete)return true;
  detail=unresolved.map(x=>x.name+" ("+x.status+") "+x.notes).join("\n").slice(0,6000);
  if(!result.complete)detail+="\nFile-specific requirements could not be verified.";
 }catch{detail="Nexus requirements could not be verified. Check the mod author’s instructions.";}
 const choice=await dialog.showMessageBox({type:"warning",buttons:["Cancel","Continue anyway"],defaultId:0,cancelId:0,message:"Mod dependencies require attention",detail});
 return choice.response===1;
}

async function validRoot(value:string){
 if(!isAbsolute(value))return null;
 try{const root=await fs.realpath(value);return (await fs.stat(root)).isDirectory()&&!isUnsafePath(root)?root:null;}catch{return null;}
}
async function detectGameRoot(gameKey:unknown):Promise<{path:string;source:"library"|"previous"}|null>{
 if(typeof gameKey!=="string"||gameKey.length>250)return null;
 const match=/^(steam|epic|custom|launchbox):(.+)$/.exec(gameKey);
 if(!match||match[1]==="launchbox")return null;
 const shop=match[1] as "steam"|"epic"|"custom";
 const game=await gamesSublevel.get(levelKeys.game(shop,match[2])).catch(()=>undefined);
 if(game&&!game.isDeleted&&game.executablePath&&isAbsolute(game.executablePath)){
  try{
   const stat=await fs.stat(game.executablePath);
   const candidate=stat.isDirectory()&&shop==="custom"&&match[2].startsWith("ubisoft-")?game.executablePath:stat.isFile()?await findGameRootFromExe(game.executablePath):null;
   const root=candidate?await validRoot(candidate):null;
   if(root)return {path:root,source:"library"};
  }catch{/* stale executable */}
 }
 const previous=[...new Set(records().filter(m=>m.gameKey===gameKey).map(m=>m.root))];
 if(previous.length===1){const root=await validRoot(previous[0]);if(root)return {path:root,source:"previous"};}
 return null;
}
ipcMain.handle("krysta:mods-game-root",(_event,gameKey:unknown)=>detectGameRoot(gameKey));
async function chooseGameRoot(gameKey:unknown){
 const detected=await detectGameRoot(gameKey);
 if(detected){
  const answer=await dialog.showMessageBox({type:"question",buttons:["Use detected folder","Choose another folder","Cancel"],defaultId:0,cancelId:2,message:"Detected game directory",detail:detected.path});
  if(answer.response===2)return null;
  if(answer.response===0)return validRoot(detected.path);
 }
 const folder=await dialog.showOpenDialog({title:"Select game installation directory",defaultPath:detected?.path,properties:["openDirectory"]});
 if(folder.canceled||!folder.filePaths[0])return null;
 const root=await validRoot(folder.filePaths[0]);
 if(!root)throw new Error("Invalid or unsafe game directory");
 return root;
}
