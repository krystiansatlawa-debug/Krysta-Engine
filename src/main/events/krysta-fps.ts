import { ipcMain, app, BrowserWindow, screen, dialog, globalShortcut } from "electron";
import { promises as fs } from "node:fs";
import { join, basename, extname } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { gamesSublevel } from "@main/level";
import { gamesPlaytime, onTrackedGamesRunningChange } from "@main/services/game-running-state";

type Position="tl"|"tr"|"bl"|"br";
type Preference={enabled:boolean;tool?:string;position?:Position;hotkey?:string};
function normalizePosition(value:unknown):Position{return value==="tr"||value==="bl"||value==="br"?value:"tl";}
function placement(bounds:Electron.Rectangle,position:Position){return {x:bounds.x+(position.endsWith("r")?bounds.width-116:16),y:bounds.y+(position.startsWith("b")?bounds.height-42:16)};}
const preferencePath=()=>join(app.getPath("userData"),"krysta-fps.json");
async function readPreference():Promise<Preference>{
 try{return JSON.parse(await fs.readFile(preferencePath(),"utf8"));}
 catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return {enabled:false};throw error;}
}
async function savePreference(value:Preference){const path=preferencePath();await fs.writeFile(path+".tmp",JSON.stringify(value),{mode:0o600});await fs.rename(path+".tmp",path);}
async function findTool(p:Preference){
 for(const path of [p.tool,join(process.resourcesPath,"PresentMon.exe"),join(app.getPath("userData"),"PresentMon.exe")]){
  if(path&&await fs.stat(path).then(s=>s.isFile()).catch(()=>false))return path;
 }
 return null;
}
let overlay:BrowserWindow|null=null, child:ChildProcess|null=null, timer:ReturnType<typeof setInterval>|null=null, activeKey="", revision=0, status="idle";
let hidden=false, registered="", shortcutError=false, lastError="", poll:ReturnType<typeof setInterval>|undefined;
let reconciling=false;
const defaultHotkey="Control+Shift+F10";
function registerHotkey(value:string){if(registered===value)return true;if(!value){if(registered)globalShortcut.unregister(registered);registered="";return true;}try{if(!globalShortcut.register(value,()=>{hidden=!hidden;if(overlay&&!overlay.isDestroyed()){if(hidden)overlay.hide();else overlay.showInactive();}refresh();}))return false;if(registered)globalShortcut.unregister(registered);registered=value;return true;}catch{return false;}}
function stop(){
 if(timer){clearInterval(timer);timer=null;}
 if(child){const old=child;child=null;old.kill();}
 if(overlay){const old=overlay;overlay=null;if(!old.isDestroyed())old.destroy();}
 activeKey="";
}
function show(value:string){
 if(overlay&&!overlay.isDestroyed()&&!overlay.webContents.isDestroyed())void overlay.webContents.executeJavaScript("document.getElementById('fps').textContent="+JSON.stringify(value)).catch(()=>{});
}
async function reconcile(){
 const generation=++revision;
 const p=await readPreference();
 shortcutError=!registerHotkey(p.hotkey??defaultHotkey);
 const tool=await findTool(p);
 const keys=Array.from(gamesPlaytime.keys());
 let target:{key:string;exe:string}|null=null;
 for(const key of keys.reverse()){
  const game=await gamesSublevel.get(key).catch(()=>null);
  if(game?.executablePath&&extname(game.executablePath).toLowerCase()===".exe"){target={key,exe:basename(game.executablePath)};break;}
 }
 if(generation!==revision)return;
 if(!p.enabled||!tool||!target){stop();status=!p.enabled?"disabled":!tool?"missing-tool":"waiting-game";return;}
 if(activeKey===target.key&&child){if(overlay&&!overlay.isDestroyed()){const display=screen.getDisplayMatching(overlay.getBounds());const point=placement(display.bounds,normalizePosition(p.position));overlay.setPosition(point.x,point.y);if(!hidden&&!overlay.isVisible())overlay.showInactive();}return;}
 stop();activeKey=target.key;status="starting";lastError="";
 const display=screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
 const w=new BrowserWindow({...placement(display.bounds,normalizePosition(p.position)),width:100,height:26,transparent:true,frame:false,focusable:false,skipTaskbar:true,alwaysOnTop:true,resizable:false,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 overlay=w;w.setIgnoreMouseEvents(true);w.setAlwaysOnTop(true,"screen-saver");
 const html='<html><body style="margin:0;background:transparent"><div id="fps" style="display:inline-block;color:#d7d7d7;background:rgba(40,40,40,.78);border:1px solid rgba(255,255,255,.10);border-radius:3px;padding:3px 6px;font: 12px Arial,sans-serif;font-weight:500">FPS: --</div></body></html>';
 await w.loadURL("data:text/html;charset=utf-8,"+encodeURIComponent(html)).catch(()=>{});
 if(generation!==revision||overlay!==w||w.isDestroyed()){if(overlay===w)stop();return;}
 if(!hidden)w.showInactive();
 const proc=spawn(tool,["--process_name",target.exe,"--output_stdout","--no_console_stats","--v1_metrics"],{windowsHide:true,stdio:["ignore","pipe","pipe"]});
 child=proc;status="waiting-frames";
 let timeColumn=-1,chainColumn=-1,pidColumn=-1,applicationColumn=-1;
 const samples=new Map<string,{sum:number;count:number}>();
 const reader=createInterface({input:proc.stdout!});
 reader.on("line",line=>{
  const row=line.trim().replace(/^\uFEFF/,"").split(",");
  if(row.includes("MsBetweenPresents")){timeColumn=row.indexOf("MsBetweenPresents");chainColumn=row.indexOf("SwapChainAddress");pidColumn=row.indexOf("ProcessID");applicationColumn=row.indexOf("Application");return;}
  if(timeColumn<0||applicationColumn<0||basename((row[applicationColumn]??"").replace(/^"|"$/g,"")).toLowerCase().replace(/\.exe$/,"")!==target.exe.toLowerCase().replace(/\.exe$/,""))return;
  const ms=Number(row[timeColumn]);if(!Number.isFinite(ms)||ms<=0||ms>10000)return;
  const key=row[pidColumn]+":"+row[chainColumn];const s=samples.get(key)??{sum:0,count:0};s.sum+=ms;s.count++;samples.set(key,s);
 });
 proc.stderr?.on("data",chunk=>{lastError=(lastError+String(chunk)).slice(-2000);});
 timer=setInterval(()=>{const best=[...samples.values()].sort((a,b)=>b.count-a.count)[0];samples.clear();status=best?"measuring":"waiting-frames";show(best?"FPS: "+Math.round(1000*best.count/best.sum):"FPS: --");},1000);
 const ended=()=>{if(child===proc){stop();status="capture-error";}};
 proc.once("error",e=>{lastError=String(e);ended();});proc.once("exit",ended);
}
function refresh(){if(process.platform==="win32"&&app.isReady()&&!reconciling){reconciling=true;void reconcile().catch(e=>{stop();status="capture-error";lastError=String(e);}).finally(()=>{reconciling=false;});}}
ipcMain.handle("krysta:fps-preference",async()=> (await readPreference()).enabled===true);
ipcMain.handle("krysta:fps-set-preference",async(_event,enabled:unknown)=>{
 if(typeof enabled!=="boolean"||process.platform!=="win32")throw new Error("Invalid FPS preference");
 await savePreference({...await readPreference(),enabled});hidden=false;refresh();return enabled;
});
ipcMain.handle("krysta:fps-position",async()=>normalizePosition((await readPreference()).position));
ipcMain.handle("krysta:fps-set-position",async(_event,position:unknown)=>{
 if(position!=="tl"&&position!=="tr"&&position!=="bl"&&position!=="br")throw new Error("Invalid FPS position");
 await savePreference({...await readPreference(),position});refresh();return position;
});
ipcMain.handle("krysta:fps-status",async()=>({available:!!await findTool(await readPreference()),status,shortcutError,lastError,hidden}));
ipcMain.handle("krysta:fps-select-tool",async()=>{
 if(process.platform!=="win32")return false;
 const result=await dialog.showOpenDialog({title:"Select official PresentMon console executable",properties:["openFile"],filters:[{name:"PresentMon",extensions:["exe"]}]});
 if(result.canceled||!result.filePaths[0])return false;
 const tool=result.filePaths[0];if(!/^presentmon.*\.exe$/i.test(basename(tool)))throw new Error("Select PresentMon executable");
 await savePreference({...await readPreference(),tool});refresh();return true;
});
ipcMain.handle("krysta:fps-hotkey",async()=> (await readPreference()).hotkey??defaultHotkey);
ipcMain.handle("krysta:fps-set-hotkey",async(_e,value:unknown)=>{
 if(typeof value!=="string"||! /^(?:(?:Control|Alt|Shift)\+){0,3}(?:F(?:[1-9]|1[0-2])|[A-Z0-9])$/.test(value)&&value!=="")throw Error("Invalid shortcut");
 if(value&&!value.includes("+")&&!/^F\d+$/.test(value))throw Error("Use a modifier with letters or numbers");
 if(!registerHotkey(value))throw Error("Shortcut already in use");
 await savePreference({...await readPreference(),hotkey:value});shortcutError=false;return value;
});
if(process.platform==="win32"){onTrackedGamesRunningChange(refresh);void app.whenReady().then(()=>{refresh();poll=setInterval(()=>{if(status!=="capture-error")refresh();},3000);});app.on("before-quit",()=>{revision++;if(poll)clearInterval(poll);if(registered)globalShortcut.unregister(registered);stop();});}
