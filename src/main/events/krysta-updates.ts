import { app, ipcMain, Notification, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
type Release={tag:string;body:string;publishedAt:string};
type Prefs={automatic:boolean;notifications:boolean;seen?:string};
const settings=()=>path.join(app.getPath("userData"),"krysta-updates.json");
async function prefs():Promise<Prefs>{try{return JSON.parse(await fs.readFile(settings(),"utf8"));}catch{return {automatic:true,notifications:true};}}
async function save(p:Prefs){await fs.writeFile(settings()+".tmp",JSON.stringify(p));await fs.rename(settings()+".tmp",settings());return p;}
// Hydra upstream version and Krysta release version are different namespaces.
const parse=(v:string)=>/^v?(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/.exec(v);
function newer(tag:string,base:string):boolean|null{
 const a=parse(tag),b=parse(base);if(!a||!b)return null;
 for(let i=1;i<=3;i++){if(Number(a[i])!==Number(b[i]))return Number(a[i])>Number(b[i]);}
 return (a[4]===undefined?Infinity:Number(a[4]))>(b[4]===undefined?Infinity:Number(b[4]));
}
async function latestKrysta():Promise<Release|null>{
 const r=await fetch("https://api.github.com/repos/krystiansatlawa-debug/Krysta-Engine/releases?per_page=100",{headers:{Accept:"application/vnd.github+json","User-Agent":"Krysta-Launcher"},signal:AbortSignal.timeout(15000),redirect:"error"});
 if(!r.ok)throw Error("GitHub HTTP "+r.status);
 const data=await r.json();if(!Array.isArray(data))throw Error("Invalid release response");
 const version=app.getVersion();const beta=/-beta\./.test(version);
 let best:Release|null=null;
 for(const d of data){
  if(d.draft||typeof d.tag_name!=="string"||!parse(d.tag_name)||(!beta&&d.prerelease))continue;
  if(!/^Krysta Launcher\b/i.test(String(d.name)))continue;
  if(!Array.isArray(d.assets)||!d.assets.some((a:{name?:string})=>/^krysta-launcher-.*-setup\.exe$/i.test(a.name??"")))continue;
  if(!best||newer(d.tag_name,best.tag)===true)best={tag:d.tag_name,body:String(d.body??"").slice(0,30000),publishedAt:String(d.published_at??"")};
 }
 return best;
}
let current:Promise<unknown>|null=null;
async function check(){
 if(current)return current;
 current=(async()=>{const version=app.getVersion(),krysta=await latestKrysta(),p=await prefs();
 const krystaNew=krysta?newer(krysta.tag,version):null;
 if(krysta&&krystaNew===true&&p.notifications&&p.seen!==krysta.tag&&Notification.isSupported()){
  const n=new Notification({title:"Krysta Launcher",body:"Dostępna nowa wersja Krysty / New Krysta release: "+krysta.tag});n.on("click",()=>void shell.openExternal("https://github.com/krystiansatlawa-debug/Krysta-Engine/releases"));n.show();await save({...p,seen:krysta.tag});
 }
 return {version,hydra:null,krysta,hydraNew:null,krystaNew,checkedAt:new Date().toISOString()};})();
 try{return await current;}finally{current=null;}
}
ipcMain.handle("krysta:updates-check",check);
ipcMain.handle("krysta:updates-prefs",prefs);
ipcMain.handle("krysta:updates-set",async(_e,automatic:unknown,notifications:unknown)=>{if(typeof automatic!=="boolean"||typeof notifications!=="boolean")throw Error("Invalid preferences");return save({...await prefs(),automatic,notifications});});
ipcMain.handle("krysta:updates-open",(_e,kind:unknown)=>{const urls={hydra:"https://github.com/hydralauncher/hydra/releases",krysta:"https://github.com/krystiansatlawa-debug/Krysta-Engine/releases",sync:"https://github.com/krystiansatlawa-debug/Krysta-Engine/actions/workflows/krysta-upstream-sync.yml"};if(kind!=="hydra"&&kind!=="krysta"&&kind!=="sync")throw Error("Invalid destination");return shell.openExternal(urls[kind]);});
void app.whenReady().then(()=>{const tick=()=>void prefs().then(p=>p.automatic?check():null).catch(()=>{});setTimeout(tick,30000);setInterval(tick,24*60*60*1000);});
