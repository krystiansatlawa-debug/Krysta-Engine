import { app, BrowserWindow, desktopCapturer, session, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Game } from "@types";
import { levelKeys } from "@main/level";
import { resolveForegroundGame, resolveForegroundWindow } from "./screenshots/foreground-game";
import { isWindowsWindowSource } from "./windows-game-window-match";
import capturePage from "@resources/krysta-recording.html?asset";

type Settings = { enabled:boolean; seconds:number; audio:boolean };
type Clip = { id:string; game:string; achievement:string; createdAt:string; duration:number; audio:boolean; size:number };
const defaults:Settings={enabled:false,seconds:15,audio:false};
const durations=[5,10,15,30,45,60];
const maxBytes=64*1024*1024;
const root=()=>path.join(app.getPath("userData"),"recordings");
const settingsPath=()=>path.join(root(),"settings.json");
const validId=(id:unknown):id is string=>typeof id==="string"&&/^[a-f0-9-]{36}$/.test(id)&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
function validSettings(value:unknown):value is Settings {
 if(!value||typeof value!=="object")return false;
 const s=value as Settings;
 return typeof s.enabled==="boolean"&&durations.includes(s.seconds)&&typeof s.audio==="boolean";
}
async function settings():Promise<Settings>{
 try{const raw=JSON.parse(await fs.readFile(settingsPath(),"utf8"));return validSettings(raw)?raw:{...defaults};}
 catch{return {...defaults};}
}
let settingsQueue:Promise<unknown>=Promise.resolve();
let busy=false,lastError="",worker:BrowserWindow|null=null,stopRequested=false;
function stop(){
 stopRequested=true;
 if(worker&&!worker.isDestroyed())void worker.webContents.executeJavaScript("globalThis.krystaStop?.()").catch(()=>{});
}
async function setSettings(value:unknown){
 if(!validSettings(value))throw Error("Invalid recording settings");
 if(value.enabled&&process.platform!=="win32")throw Error("Windows only");
 if(!value.enabled)stop();
 const job=settingsQueue.then(async()=>{
  await fs.mkdir(root(),{recursive:true});
  const tmp=settingsPath()+"."+randomUUID()+".tmp";
  try{await fs.writeFile(tmp,JSON.stringify(value),{flag:"wx",mode:0o600});await fs.rename(tmp,settingsPath());}
  finally{await fs.rm(tmp,{force:true});}
 });
 settingsQueue=job.catch(()=>{});await job;
}
async function safeClip(id:unknown){
 if(!validId(id))throw Error("Invalid recording id");
 const file=path.join(root(),id+".webm");
 const stat=await fs.lstat(file);
 if(!stat.isFile()||stat.isSymbolicLink())throw Error("Invalid recording");
 return {file,stat};
}
async function list():Promise<Clip[]>{
 const entries=await fs.readdir(root()).catch(()=>[] as string[]);
 const clips:Clip[]=[];
 for(const name of entries.filter(n=>n.endsWith(".json")&&validId(n.slice(0,-5)))){
  try{
   const id=name.slice(0,-5),info=path.join(root(),name),st=await fs.lstat(info);
   if(!st.isFile()||st.size>32768)continue;
   const c=JSON.parse(await fs.readFile(info,"utf8")) as Clip;
   if(c.id!==id||typeof c.game!=="string"||typeof c.achievement!=="string"||!Number.isFinite(Date.parse(c.createdAt))||!Number.isFinite(c.duration)||typeof c.audio!=="boolean")continue;
   const {stat}=await safeClip(id);
   clips.push({...c,size:stat.size});
  }catch{/* incomplete or deleted recording */}
 }
 return clips.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
export async function recordingState(){
 return {supported:process.platform==="win32",settings:await settings(),recording:busy,lastError,clips:await list()};
}
export async function recordAchievementClip(game:Game,achievementNames:string[]){
 if(process.platform!=="win32"||!app.isReady()||busy||!achievementNames.length)return;
 busy=true;stopRequested=false;
 let local:BrowserWindow|null=null;
 let timer:ReturnType<typeof setInterval>|undefined;
 let deadline:ReturnType<typeof setTimeout>|undefined;
 let captureSession:Electron.Session|null=null;
 let createdFile:string|undefined;
 let createdInfo:string|undefined;
 try{
  const prefs=await settings();
  if(!prefs.enabled||stopRequested)return;
  const match=await resolveForegroundGame("deeplink");
  const key=levelKeys.game(game.shop,game.objectId);
  if(match.status!=="resolved"||match.target.gameKey!==key||!match.foreground?.windowHandle||match.foreground.processId==null)return;
  const handle=match.foreground.windowHandle,pid=match.foreground.processId;
  const sources=await desktopCapturer.getSources({types:["window"],thumbnailSize:{width:0,height:0},fetchWindowIcons:false});
  const source=sources.find(s=>isWindowsWindowSource(s.id,handle));
  if(!source||stopRequested)throw Error("Game window unavailable");
  const foreground=await resolveForegroundWindow();
  if(!foreground||foreground.processId!==pid||foreground.windowHandle!==handle||stopRequested)return;
  lastError="";
  captureSession=session.fromPartition("krysta-clip-"+randomUUID());
  local=new BrowserWindow({show:false,focusable:false,skipTaskbar:true,webPreferences:{session:captureSession,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  worker=local;
  const win=local;
  const allowed=()=>!stopRequested&&!win.isDestroyed();
  captureSession.setPermissionRequestHandler((contents,permission,callback)=>callback(allowed()&&contents===win.webContents&&permission==="display-capture"));
  captureSession.setPermissionCheckHandler((contents,permission)=>allowed()&&contents===win.webContents&&permission==="display-capture");
  captureSession.setDisplayMediaRequestHandler((request,callback)=>{
   if(!allowed()||request.frame!==win.webContents.mainFrame||!request.videoRequested){callback({});return;}
   callback(prefs.audio&&request.audioRequested?{video:source,audio:"loopback"}:{video:source});
  });
  win.webContents.setWindowOpenHandler(()=>({action:"deny"}));
  win.webContents.on("will-navigate",e=>e.preventDefault());
  await win.loadFile(capturePage);
  if(stopRequested)return;
  let checking=false;
  timer=setInterval(()=>{
   if(checking||stopRequested)return;checking=true;
   void resolveForegroundWindow().then(f=>{
    if(!f||f.processId!==pid||f.windowHandle!==handle)stop();
   }).catch(()=>stop()).finally(()=>{checking=false;});
  },400);
  // The dedicated renderer can only receive the already verified game window.
  // Audio is Windows system loopback, never microphone input.
  const result=await Promise.race([
   win.webContents.executeJavaScript("globalThis.krystaRecord("+JSON.stringify({seconds:prefs.seconds,audio:prefs.audio,maxBytes})+")",true) as Promise<{data:string;duration:number;audio:boolean}>,
   new Promise<never>((_,reject)=>{deadline=setTimeout(()=>reject(Error("Recording timed out")), (prefs.seconds+20)*1000);})
  ]);
  if(!result||typeof result.data!=="string"||result.data.length>Math.ceil(maxBytes/3)*4+4||!Number.isFinite(result.duration)||result.duration<1||result.duration>prefs.seconds+3)return;
  const bytes=Buffer.from(result.data,"base64");
  if(!bytes.length||bytes.length>maxBytes||bytes.subarray(0,4).toString("hex")!=="1a45dfa3")throw Error("Invalid WebM recording");
  const id=randomUUID();
  const clip:Clip={id,game:game.title.slice(0,300),achievement:achievementNames.join(" · ").slice(0,500),createdAt:new Date(Date.now()-result.duration*1000).toISOString(),duration:Math.round(result.duration*10)/10,audio:result.audio===true,size:bytes.length};
  await fs.mkdir(root(),{recursive:true});
  createdFile=path.join(root(),id+".webm");
  createdInfo=path.join(root(),id+".json");
  await fs.writeFile(createdFile,bytes,{flag:"wx"});
  await fs.writeFile(createdInfo,JSON.stringify(clip),{flag:"wx",mode:0o600});
  createdFile=undefined;createdInfo=undefined;
 }catch(error){
  lastError=String(error).slice(0,500);
 }finally{
  if(timer)clearInterval(timer);if(deadline)clearTimeout(deadline);
  if(local&&!local.isDestroyed())local.destroy();
  captureSession?.setDisplayMediaRequestHandler(null);
  captureSession?.setPermissionRequestHandler(null);
  captureSession?.setPermissionCheckHandler(null);
  if(createdFile)await fs.rm(createdFile,{force:true}).catch(()=>{});
  if(createdInfo)await fs.rm(createdInfo,{force:true}).catch(()=>{});
  worker=null;busy=false;
 }
}
export async function openRecording(id:unknown){const {file}=await safeClip(id);const error=await shell.openPath(file);if(error)throw Error(error);}
export async function deleteRecording(id:unknown){const {file}=await safeClip(id);await fs.unlink(file);await fs.rm(path.join(root(),String(id)+".json"),{force:true});}
export async function openRecordingsFolder(){await fs.mkdir(root(),{recursive:true});const error=await shell.openPath(root());if(error)throw Error(error);}
export {setSettings as setRecordingSettings,stop as stopRecording};
app.on("before-quit",()=>{stop();if(worker&&!worker.isDestroyed())worker.destroy();});
