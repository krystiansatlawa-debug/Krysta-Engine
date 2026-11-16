import { app, ipcMain, Notification, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
type Release={tag:string;body:string;publishedAt:string};
type Prefs={automatic:boolean;notifications:boolean;seen?:string};
const settings=()=>path.join(app.getPath("userData"),"krysta-updates.json");
async function prefs():Promise<Prefs>{try{return JSON.parse(await fs.readFile(settings(),"utf8"));}catch{return {automatic:true,notifications:true};}}
async function save(p:Prefs){await fs.writeFile(settings()+".tmp",JSON.stringify(p));await fs.rename(settings()+".tmp",settings());return p;}
async function latest(repo:string):Promise<Release|null>{
 const r=await fetch("https://api.github.com/repos/"+repo+"/releases/latest",{headers:{Accept:"application/vnd.github+json","User-Agent":"Krysta-Launcher"},signal:AbortSignal.timeout(15000),redirect:"error"});
 if(r.status===404)return null;if(!r.ok)throw Error("GitHub HTTP "+r.status);
 const d=await r.json();if(typeof d.tag_name!=="string")throw Error("Invalid release response");
 return {tag:d.tag_name,body:String(d.body??"").slice(0,30000),publishedAt:String(d.published_at??"")};
}
function newer(tag:string,base:string){const parse=(s:string)=>/^v?(\d+)\.(\d+)\.(\d+)$/.exec(s)?.slice(1).map(Number);const a=parse(tag),b=parse(base);if(!a||!b)return null;for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return false;}
let current:Promise<unknown>|null=null;
async function check(){
 if(current)return current;
 current=(async()=>{const version=app.getVersion();const [hydra,krysta]=await Promise.all([latest("hydralauncher/hydra"),latest("krystiansatlawa-debug/Krysta-Engine")]);const p=await prefs();
 if(hydra&&newer(hydra.tag,version)===true&&p.notifications&&p.seen!==hydra.tag&&Notification.isSupported()){new Notification({title:"Krysta Launcher",body:"Hydra "+hydra.tag+" – new upstream release / nowa wersja bazowa"}).show();await save({...p,seen:hydra.tag});}
 return {version,hydra,krysta,hydraNew:hydra?newer(hydra.tag,version):null,krystaNew:krysta?newer(krysta.tag,version):null,checkedAt:new Date().toISOString()};})();
 try{return await current;}finally{current=null;}
}
ipcMain.handle("krysta:updates-check",check);
ipcMain.handle("krysta:updates-prefs",prefs);
ipcMain.handle("krysta:updates-set",async(_e,automatic:unknown,notifications:unknown)=>{if(typeof automatic!=="boolean"||typeof notifications!=="boolean")throw Error("Invalid preferences");return save({...await prefs(),automatic,notifications});});
ipcMain.handle("krysta:updates-open",(_e,kind:unknown)=>{const urls={hydra:"https://github.com/hydralauncher/hydra/releases",krysta:"https://github.com/krystiansatlawa-debug/Krysta-Engine/releases",sync:"https://github.com/krystiansatlawa-debug/Krysta-Engine/actions/workflows/krysta-upstream-sync.yml"};if(kind!=="hydra"&&kind!=="krysta"&&kind!=="sync")throw Error("Invalid destination");return shell.openExternal(urls[kind]);});
void app.whenReady().then(()=>{const tick=()=>void prefs().then(p=>p.automatic?check():null).catch(()=>{});setTimeout(tick,30000);setInterval(tick,24*60*60*1000);});
