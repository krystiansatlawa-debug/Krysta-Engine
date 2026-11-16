import { ipcMain, net, safeStorage, app, dialog } from "electron";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { SevenZip } from "@main/services/7zip";
import { createWriteStream, renameSync, promises as fs } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { join, basename } from "node:path";
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

type Installed = {id:string;name:string;root:string;files:{path:string;hash:string}[]};
const manifest=()=>join(app.getPath("userData"),"krysta-installed-mods.json");
function records():Installed[]{try{return JSON.parse(readFileSync(manifest(),"utf8"));}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return [];throw e;}}
function save(entries:Installed[]){const target=manifest(),temp=target+".tmp";writeFileSync(temp,JSON.stringify(entries),{mode:0o600});renameSync(temp,target);}
function parts(name:string){const items=name.replace(/\\/g,"/").split("/");if(items.some(v=>!v||v==="."||v===".."||/[<>:"|?*\x00-\x1f]/.test(v)||/[. ]$/.test(v)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(v)))throw new Error("Unsafe archive path");return items;}
async function target(root:string,name:string,create=false){const items=parts(name);let path=root;for(const part of items.slice(0,-1)){path=join(path,part);if(create)await fs.mkdir(path).catch(e=>{if(e.code!=="EEXIST")throw e;});const stat=await fs.lstat(path).catch(e=>{if(e.code==="ENOENT")return null;throw e;});if(stat&&(!stat.isDirectory()||stat.isSymbolicLink()))throw new Error("Unsafe destination");}return join(path,items[items.length-1]);}
async function exists(path:string){try{await fs.lstat(path);return true;}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return false;throw e;}}
const hash=(buffer:Buffer)=>createHash("sha256").update(buffer).digest("hex");
let modifying=false;
async function exclusive<T>(work:()=>Promise<T>){if(modifying)throw new Error("Another mod operation is active");modifying=true;try{return await work();}finally{modifying=false;}}
ipcMain.handle("krysta:mods-installed",()=>records().map(({id,name,root})=>({id,name,root})));
ipcMain.handle("krysta:mods-install-local",()=>exclusive(async()=>{
 const archive=await dialog.showOpenDialog({properties:["openFile"],filters:[{name:"Mod archive",extensions:["zip","7z","rar"]}]});if(archive.canceled)return false;
 const folder=await dialog.showOpenDialog({title:"Select game installation directory",properties:["openDirectory"]});if(folder.canceled)return false;
 const root=await fs.realpath(folder.filePaths[0]), source=archive.filePaths[0];
 const entries=await SevenZip.listEntries(source);
 if(!entries.length||entries.length>2000||entries.some(e=>e.encrypted||e.size>128*1024*1024)||entries.reduce((n,e)=>n+e.size,0)>1024*1024*1024)throw new Error("Unsupported archive");
 const seen=new Set<string>();
 for(const entry of entries){const name=parts(entry.name).join("/").toLowerCase();if(seen.has(name))throw new Error("Duplicate archive path");seen.add(name);if(await exists(await target(root,entry.name)))throw new Error("Conflict: "+entry.name);}
 const confirm=await dialog.showMessageBox({type:"warning",buttons:["Cancel","Install"],defaultId:0,cancelId:0,message:"Install "+entries.length+" files into "+root+"?",detail:"Only simple archives with paths relative to the game folder are supported. Mods can contain executable code. Install only trusted files."});if(confirm.response!==1)return false;
 const record:Installed={id:randomUUID(),name:basename(source),root,files:[]};
 try{
  for(const entry of entries){const buffer=await SevenZip.readEntry(source,entry.name,Math.max(1,entry.size+1));if(buffer.length!==entry.size)throw new Error("Archive size mismatch");const dest=await target(root,entry.name,true);await fs.writeFile(dest,buffer,{flag:"wx"});record.files.push({path:entry.name,hash:hash(buffer)});}
  save([...records(),record]);
 }catch(e){for(const file of record.files){const dest=await target(root,file.path);if(await exists(dest)&&hash(await fs.readFile(dest))===file.hash)await fs.unlink(dest);}throw e;}
 return true;
}));
ipcMain.handle("krysta:mods-remove",(_event,id:unknown)=>exclusive(async()=>{
 const entries=records(),record=entries.find(e=>e.id===id);if(!record)throw new Error("Unknown mod");
 const root=await fs.realpath(record.root);if(root!==record.root)throw new Error("Game directory changed");
 for(const file of record.files){const dest=await target(root,file.path);if(await exists(dest)){const stat=await fs.lstat(dest);if(!stat.isFile()||stat.isSymbolicLink()||hash(await fs.readFile(dest))!==file.hash)throw new Error("Modified file: "+file.path);}}
 const confirm=await dialog.showMessageBox({type:"warning",buttons:["Cancel","Remove"],defaultId:0,cancelId:0,message:"Remove "+record.name+"?"});if(confirm.response!==1)return false;
 for(const file of record.files){const dest=await target(root,file.path);if(await exists(dest))await fs.unlink(dest);}
 save(entries.filter(e=>e.id!==id));return true;
}));
