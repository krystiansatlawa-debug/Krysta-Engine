import { app, dialog, ipcMain } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { gamesSublevel, levelKeys } from "@main/level";
import { Ludusavi } from "@main/services/ludusavi";
import { isTrackedGameKeyRunning } from "@main/services/game-running-state";
import type { GameShop } from "@types";

type Provider="google"|"synology"|"local"|"hydra";
type Config={provider:Provider;folder?:string};
type Entry={id:string;createdAt:string;files:number};
const cfgPath=()=>path.join(app.getPath("userData"),"krysta-cloud.json");
async function config():Promise<Config>{try{return JSON.parse(await fs.readFile(cfgPath(),"utf8"));}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return {provider:"hydra"};throw e;}}
async function save(c:Config){const file=cfgPath();await fs.writeFile(file+".tmp",JSON.stringify(c),{mode:0o600});await fs.rename(file+".tmp",file);return c;}
function digest(s:string){return createHash("sha256").update(s).digest("hex");}
function within(root:string,p:string){const rel=path.relative(root,p);return rel===""||(!rel.startsWith(".."+path.sep)&&rel!==".."&&!path.isAbsolute(rel));}
async function gameContext(shop:GameShop,id:string){
 if(typeof shop!=="string"||typeof id!=="string"||!id||id.length>200)throw Error("Invalid game");
 const key=levelKeys.game(shop,id);const game=await gamesSublevel.get(key);
 if(!game)throw Error("Game not in library");
 const c=await config();if(c.provider==="hydra"||!c.folder)throw Error("Select a private cloud folder in settings");
 const root=await fs.realpath(c.folder);
 const base=path.join(root,"Krysta Cloud",digest(shop+":"+id));
 return {key,game,base,root};
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
ipcMain.handle("krysta:cloud-provider",async(_e,p:unknown)=>{if(p!=="google"&&p!=="synology"&&p!=="local"&&p!=="hydra")throw Error("Invalid provider");return save({provider:p});});
ipcMain.handle("krysta:cloud-folder",async()=>{const c=await config();if(c.provider==="hydra")return c;const result=await dialog.showOpenDialog({properties:["openDirectory","createDirectory"]});if(result.canceled||!result.filePaths[0])return c;return save({...c,folder:await fs.realpath(result.filePaths[0])});});
ipcMain.handle("krysta:cloud-list",async(_e,shop:GameShop,id:string)=>{
 const {base,root}=await gameContext(shop,id);await safeDirectory(root,base);
 const list:Entry[]=[];for(const name of await fs.readdir(base)){if(!/^[0-9a-f-]{36}$/.test(name))continue;try{const dir=await fs.realpath(path.join(base,name));if(dir!==path.join(base,name))continue;const m=JSON.parse(await fs.readFile(path.join(dir,"manifest.json"),"utf8"));if(m.id===name&&Array.isArray(m.files)&&typeof m.createdAt==="string")list.push({id:name,createdAt:m.createdAt,files:m.files.length});}catch{continue;}}
 return list.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
});
ipcMain.handle("krysta:cloud-backup",async(_e,shop:GameShop,id:string)=>{
 const {key,base,root}=await gameContext(shop,id);
 return locked(key,async()=>{if(isTrackedGameKeyRunning(key))throw Error("Close the game before backing up");
 const files=await discover(shop,id);if(!files.length)throw Error("No save files detected by Ludusavi");
 if(files.length>5000)throw Error("Too many save files");
 if(files.some(p=>within(root,p)))throw Error("Save files overlap cloud folder");
 const answer=await dialog.showMessageBox({type:"question",buttons:["Cancel","Create backup"],defaultId:0,cancelId:0,message:"Create a copy of "+files.length+" detected save files in your selected cloud folder?"});if(answer.response!==1)return false;
 await safeDirectory(root,base);const uuid=randomUUID(),temp=path.join(base,".pending-"+uuid);await fs.mkdir(temp);
 try{const entries=[];let total=0;for(const [i,p] of files.entries()){const st=await fs.stat(p);total+=st.size;if(total>5*1024**3)throw Error("Backup exceeds 5 GB");const name=String(i);await copyVerified(p,path.join(temp,name));entries.push({name,original:p,size:st.size});}if(isTrackedGameKeyRunning(key))throw Error("Game started during backup");await fs.writeFile(path.join(temp,"manifest.json"),JSON.stringify({id:uuid,createdAt:new Date().toISOString(),files:entries}));await fs.rename(temp,path.join(base,uuid));return true;}catch(e){await fs.rm(temp,{recursive:true,force:true});throw e;}
 });
});
