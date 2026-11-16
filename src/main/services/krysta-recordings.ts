import { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, session, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Game } from "@types";
import { levelKeys } from "@main/level";
import { hasTrackedGamesRunning } from "./game-running-state";
import { resolveForegroundGame, resolveForegroundWindow } from "./screenshots/foreground-game";
import { isWindowsWindowSource } from "./windows-game-window-match";
import capturePage from "@resources/krysta-recording.html?asset";

type Settings={enabled:boolean;seconds:number;audio:boolean;preSeconds:number;quality:number;fps:number;limitGb:number;hotkey:string;folder?:string};
type Clip={id:string;game:string;achievement:string;createdAt:string;duration:number;audio:boolean;size:number;thumbnail?:string;before?:number};
type Result={data:string;duration:number;audio:boolean;thumbnail?:string;before:number};
type Active={win:BrowserWindow;session:Electron.Session;game:Game;key:string;handle:string;pid:number;prefs:Settings;saving:boolean;stopped:boolean};
const defaults:Settings={enabled:false,seconds:15,audio:false,preSeconds:10,quality:1080,fps:30,limitGb:10,hotkey:"Control+Shift+F9"};
const durations=[5,10,15,30,45,60], preDurations=[0,5,10,15,30], qualities=[720,1080,1440], frameRates=[30,60], limits=[1,5,10,20,50], hotkeys=["","Control+Shift+F9","Control+Shift+F8","Alt+F9","F9"];
const maxBytes=96*1024*1024;
const root=()=>path.join(app.getPath("userData"),"recordings");
const settingsPath=()=>path.join(root(),"settings.json");
const folder=(s:Settings)=>s.folder||root();
const validId=(id:unknown):id is string=>typeof id==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
const thumbnail=(value:unknown):value is string=>typeof value==="string"&&value.length<=24000&&/^data:image\/jpeg;base64,[a-zA-Z0-9+/=]+$/.test(value);
function normalize(value:unknown):Settings|null {
 if(!value||typeof value!=="object")return null;
 const raw=value as Partial<Settings>,s={...defaults,...raw};
 if(typeof s.enabled!=="boolean"||typeof s.audio!=="boolean"||!durations.includes(s.seconds)||!preDurations.includes(s.preSeconds)||!qualities.includes(s.quality)||!frameRates.includes(s.fps)||!limits.includes(s.limitGb)||!hotkeys.includes(s.hotkey))return null;
 return {...s,folder:typeof s.folder==="string"&&path.isAbsolute(s.folder)?s.folder:undefined};
}
let preferences:Settings|null=null,loading:Promise<Settings>|null=null;
async function settings():Promise<Settings>{
 if(preferences)return preferences;
 if(!loading)loading=fs.readFile(settingsPath(),"utf8").then(s=>normalize(JSON.parse(s))??{...defaults}).catch(()=>({...defaults})).then(s=>preferences=s).finally(()=>{loading=null;});
 return loading;
}
let settingsQueue:Promise<unknown>=Promise.resolve();
let current:Active|null=null,opening:Promise<Active|null>|null=null,epoch=0,quitting=false,checking=false,lastError="",registered="",shortcutError=false,pausedWindow="",retryAt=0;
let timer:ReturnType<typeof setInterval>|undefined;
const signature=(handle:string,pid:number)=>handle+":"+pid;
function dispose(a:Active){
 if(current===a)current=null;
 a.stopped=true;
 if(!a.win.isDestroyed())a.win.destroy();
 a.session.setDisplayMediaRequestHandler(null);
}
function end(a:Active){
 if(a.stopped)return;
 a.stopped=true;
 if(a.saving&&!a.win.isDestroyed())void a.win.webContents.executeJavaScript("globalThis.krystaStop?.()").catch(()=>dispose(a));
 else dispose(a);
}
function cancel(pause=false){
 epoch++;
 if(current){if(pause)pausedWindow=signature(current.handle,current.pid);end(current);}
}
function stopRecording(){cancel(true);}
async function saveSettings(next:Settings){
 const job=settingsQueue.then(async()=>{
  await fs.mkdir(root(),{recursive:true});
  const tmp=settingsPath()+"."+randomUUID()+".tmp";
  try{await fs.writeFile(tmp,JSON.stringify(next),{flag:"wx",mode:0o600});await fs.rename(tmp,settingsPath());}
  finally{await fs.rm(tmp,{force:true});}
  preferences=next;pausedWindow="";retryAt=0;cancel();applyHotkey(next);
 });
 settingsQueue=job.catch(()=>{});await job;
}
function applyHotkey(s:Settings){
 if(process.platform!=="win32"||!app.isReady())return;
 const desired=s.enabled?s.hotkey:"";
 if(registered===desired)return;
 if(registered)globalShortcut.unregister(registered);
 registered="";shortcutError=false;
 if(desired){
  try{if(globalShortcut.register(desired,()=>{void trigger(null,["Manual clip"]);}))registered=desired;else shortcutError=true;}
  catch{shortcutError=true;}
 }
}
export async function setRecordingSettings(value:unknown){
 const s=normalize(value);if(!s)throw Error("Invalid recording settings");
 if(s.enabled&&process.platform!=="win32")throw Error("Windows only");
 const old=await settings();
 await saveSettings({...s,folder:old.folder});
}
export async function chooseRecordingFolder(reset=false){
 const old=await settings();
 if(reset){await saveSettings({...old,folder:undefined});return;}
 const result=await dialog.showOpenDialog({title:"Krysta recordings",defaultPath:folder(old),properties:["openDirectory","createDirectory"]});
 if(result.canceled||!result.filePaths[0])return;
 const chosen=path.resolve(result.filePaths[0]);
 await saveSettings({...old,folder:chosen});
}
async function safeClip(id:unknown,dir:string){
 if(!validId(id))throw Error("Invalid recording id");
 const file=path.join(dir,id+".webm"),stat=await fs.lstat(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maxBytes)throw Error("Invalid recording");
 return {file,stat};
}
async function list(dir:string):Promise<Clip[]>{
 const entries=await fs.readdir(dir).catch(()=>[] as string[]),clips:Clip[]=[];
 for(const name of entries.filter(n=>n.endsWith(".json")&&validId(n.slice(0,-5)))){
  try{
   const id=name.slice(0,-5),info=path.join(dir,name),st=await fs.lstat(info);
   if(!st.isFile()||st.size>65536)continue;
   const c=JSON.parse(await fs.readFile(info,"utf8")) as Clip;
   if(c.id!==id||typeof c.game!=="string"||typeof c.achievement!=="string"||!Number.isFinite(Date.parse(c.createdAt))||!Number.isFinite(c.duration)||typeof c.audio!=="boolean")continue;
   const {stat}=await safeClip(id,dir);
   clips.push({id,game:c.game,achievement:c.achievement,createdAt:c.createdAt,duration:c.duration,audio:c.audio,size:stat.size,before:typeof c.before==="number"&&Number.isFinite(c.before)?c.before:undefined,thumbnail:thumbnail(c.thumbnail)?c.thumbnail:undefined});
  }catch{/* incomplete recording */}
 }
 return clips.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
async function persist(a:Active,result:Result,names:string[]){
 if(!result||typeof result.data!=="string"||result.data.length>Math.ceil(maxBytes/3)*4+4||!Number.isFinite(result.duration)||result.duration<1||result.duration>a.prefs.seconds+a.prefs.preSeconds+4)return;
 const bytes=Buffer.from(result.data,"base64");
 if(!bytes.length||bytes.length>maxBytes||bytes.subarray(0,4).toString("hex")!=="1a45dfa3")throw Error("Invalid WebM recording");
 const dir=folder(a.prefs);
 await fs.mkdir(dir,{recursive:true});
 const used=(await list(dir)).reduce((n,c)=>n+c.size,0);
 if(used+bytes.length>a.prefs.limitGb*1024**3)throw Error("Limit nagrań osiągnięty / Recording storage limit reached");
 const id=randomUUID(),file=path.join(dir,id+".webm"),info=path.join(dir,id+".json");
 const clip:Clip={id,game:a.game.title.slice(0,300),achievement:names.join(" · ").slice(0,500),createdAt:new Date(Date.now()-result.duration*1000).toISOString(),duration:Math.round(result.duration*10)/10,before:Math.round(Math.max(0,Math.min(result.before,a.prefs.preSeconds))*10)/10,audio:result.audio===true,size:bytes.length,thumbnail:thumbnail(result.thumbnail)?result.thumbnail:undefined};
 try{await fs.writeFile(file,bytes,{flag:"wx"});await fs.writeFile(info,JSON.stringify(clip),{flag:"wx",mode:0o600});}
 catch(e){await fs.rm(file,{force:true}).catch(()=>{});await fs.rm(info,{force:true}).catch(()=>{});throw e;}
}
async function sameForeground(a:Active){
 const f=await resolveForegroundWindow();
 return !!f&&f.processId===a.pid&&f.windowHandle===a.handle;
}
async function openCapture(prefs:Settings,expected:string|null,generation:number):Promise<Active|null>{
 const match=await resolveForegroundGame("deeplink");
 if(match.status!=="resolved"||!match.game||!match.foreground?.windowHandle||match.foreground.processId==null||(expected&&match.target.gameKey!==expected))return null;
 const handle=match.foreground.windowHandle,pid=match.foreground.processId;
 if(pausedWindow===signature(handle,pid)||generation!==epoch||quitting)return null;
 const sources=await desktopCapturer.getSources({types:["window"],thumbnailSize:{width:0,height:0},fetchWindowIcons:false});
 const source=sources.find(s=>isWindowsWindowSource(s.id,handle));
 const foreground=await resolveForegroundWindow();
 if(!source||!foreground||foreground.processId!==pid||foreground.windowHandle!==handle||generation!==epoch||quitting)return null;
 const captureSession=session.fromPartition("krysta-recordings-worker");
 const win=new BrowserWindow({show:false,focusable:false,skipTaskbar:true,webPreferences:{session:captureSession,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 const a:Active={win,session:captureSession,game:match.game,key:match.target.gameKey,handle,pid,prefs,saving:false,stopped:false};
 current=a;
 const allowed=()=>current===a&&!a.stopped&&!win.isDestroyed()&&generation===epoch;
 captureSession.setPermissionRequestHandler((contents,permission,callback)=>callback(allowed()&&contents===win.webContents&&permission==="display-capture"));
 captureSession.setPermissionCheckHandler((contents,permission)=>allowed()&&contents===win.webContents&&permission==="display-capture");
 captureSession.setDisplayMediaRequestHandler((request,callback)=>{
  if(!allowed()||request.frame!==win.webContents.mainFrame||!request.videoRequested){callback({});return;}
  void sameForeground(a).then(ok=>{if(!ok||!allowed())callback({});else callback(prefs.audio&&request.audioRequested?{video:source,audio:"loopback"}:{video:source});}).catch(()=>callback({}));
 });
 win.webContents.setWindowOpenHandler(()=>({action:"deny"}));
 win.webContents.on("will-navigate",e=>e.preventDefault());
 win.webContents.once("render-process-gone",()=>{if(current===a){lastError="Recording worker exited";dispose(a);}});
 let deadline:ReturnType<typeof setTimeout>|undefined;
 try{
  await win.loadFile(capturePage);
  if(!allowed()||!await sameForeground(a)){dispose(a);return null;}
  await Promise.race([win.webContents.executeJavaScript("globalThis.krystaStart("+JSON.stringify({...prefs,maxBytes})+")",true),new Promise<never>((_,reject)=>{deadline=setTimeout(()=>reject(Error("Capture startup timed out")),15000);})]);
  if(!allowed()||!await sameForeground(a)){dispose(a);return null;}
  lastError="";return a;
 }catch(e){if(current===a)dispose(a);throw e;}
 finally{if(deadline)clearTimeout(deadline);}
}
async function ensure(expected:string|null=null):Promise<Active|null>{
 if(current&&!current.stopped&&!opening&&(!expected||current.key===expected))return current;
 if(opening)return opening;
 if(current)return null;
 const s=await settings();
 if(!s.enabled||quitting||process.platform!=="win32")return null;
 if(opening)return opening;
 if(current)return current.stopped?null:current;
 const generation=epoch;
 opening=openCapture(s,expected,generation).catch(error=>{if(generation===epoch){lastError=String(error).slice(0,500);retryAt=Date.now()+5000;}return null;}).finally(()=>{opening=null;});
 return opening;
}
let triggering=false;
async function trigger(expected:string|null,names:string[]){
 if(triggering||quitting||process.platform!=="win32"||!app.isReady())return;
 triggering=true;
 let a:Active|null=null,deadline:ReturnType<typeof setTimeout>|undefined;
 try{
  const s=await settings();if(!s.enabled)return;
  a=await ensure(expected);
  if(!a||a.stopped||a.saving||(expected&&a.key!==expected)||!await sameForeground(a))return;
  a.saving=true;
  const result=await Promise.race([
   a.win.webContents.executeJavaScript("globalThis.krystaSave()") as Promise<Result>,
   new Promise<never>((_,reject)=>{deadline=setTimeout(()=>reject(Error("Recording timed out")), (a!.prefs.seconds+20)*1000);})
  ]);
  await persist(a,result,names);lastError="";
 }catch(e){lastError=String(e).slice(0,500);if(a&&current===a)end(a);}
 finally{
  if(deadline)clearTimeout(deadline);
  if(a){a.saving=false;if(a.stopped||a.prefs.preSeconds===0){if(current===a)dispose(a);}}
  triggering=false;
 }
}
export async function recordAchievementClip(game:Game,achievementNames:string[]){
 if(achievementNames.length)await trigger(levelKeys.game(game.shop,game.objectId),achievementNames);
}
async function reconcile(){
 if(checking||quitting||process.platform!=="win32")return;
 checking=true;
 try{
  const s=await settings();
  if(!s.enabled||!hasTrackedGamesRunning()){if(current)end(current);if(!hasTrackedGamesRunning())pausedWindow="";return;}
  const f=await resolveForegroundWindow(),sig=f?.windowHandle&&f.processId!=null?signature(f.windowHandle,f.processId):"";
  if(pausedWindow&&sig!==pausedWindow)pausedWindow="";
  if(current&&(!sig||signature(current.handle,current.pid)!==sig)){end(current);return;}
  if(!current&&!opening&&sig&&sig!==pausedWindow&&s.preSeconds>0&&Date.now()>=retryAt){const a=await ensure();if(!a)retryAt=Date.now()+2000;}
 }catch(e){if(current)end(current);lastError=String(e).slice(0,500);}
 finally{checking=false;}
}
export async function recordingState(){
 const s=await settings(),dir=folder(s),clips=await list(dir);
 return {supported:process.platform==="win32",settings:s,folder:dir,recording:!!current?.saving,buffering:!!current&&!current.stopped&&!current.saving&&s.preSeconds>0,shortcutError,lastError,usedBytes:clips.reduce((n,c)=>n+c.size,0),clips};
}
export async function openRecording(id:unknown){const {file}=await safeClip(id,folder(await settings()));const error=await shell.openPath(file);if(error)throw Error(error);}
export async function readRecording(id:unknown){const {file}=await safeClip(id,folder(await settings()));return (await fs.readFile(file)).toString("base64");}
export async function deleteRecording(id:unknown){const dir=folder(await settings()),{file}=await safeClip(id,dir);await fs.unlink(file);await fs.rm(path.join(dir,String(id)+".json"),{force:true});}
export async function openRecordingsFolder(){const dir=folder(await settings());await fs.mkdir(dir,{recursive:true});const error=await shell.openPath(dir);if(error)throw Error(error);}
export {stopRecording};
void app.whenReady().then(async()=>{if(process.platform!=="win32")return;applyHotkey(await settings());timer=setInterval(()=>void reconcile(),500);timer.unref?.();}).catch(()=>{});
app.on("before-quit",()=>{quitting=true;epoch++;if(timer)clearInterval(timer);if(registered)globalShortcut.unregister(registered);if(current)dispose(current);});
