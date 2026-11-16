import { ipcMain, net, safeStorage, app } from "electron";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
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
