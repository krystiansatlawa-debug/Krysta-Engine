import { ipcMain, app } from "electron";
import { promises as fs } from "node:fs";
import { join } from "node:path";

const preferencePath=()=>join(app.getPath("userData"),"krysta-fps.json");
async function getPreference():Promise<boolean>{
 try{return JSON.parse(await fs.readFile(preferencePath(),"utf8")).enabled===true;}
 catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return false;throw error;}
}
ipcMain.handle("krysta:fps-preference",getPreference);
ipcMain.handle("krysta:fps-set-preference",async(_event,enabled:unknown)=>{
 if(typeof enabled!=="boolean"||process.platform!=="win32")throw new Error("Invalid FPS preference");
 const path=preferencePath();
 await fs.writeFile(path+".tmp",JSON.stringify({enabled}),{mode:0o600});
 await fs.rename(path+".tmp",path);
 return enabled;
});
