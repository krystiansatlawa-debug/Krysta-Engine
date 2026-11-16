import { ipcMain, app, BrowserWindow, screen, dialog } from "electron";
import { promises as fs } from "node:fs";
import { join, basename, extname } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { gamesSublevel } from "@main/level";
import { gamesPlaytime, onTrackedGamesRunningChange } from "@main/services/game-running-state";

type Preference={enabled:boolean;tool?:string};
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
 const tool=await findTool(p);
 const keys=Array.from(gamesPlaytime.keys());
 let target:{key:string;exe:string}|null=null;
 for(const key of keys.reverse()){
  const game=await gamesSublevel.get(key).catch(()=>null);
  if(game?.executablePath&&extname(game.executablePath).toLowerCase()===".exe"){target={key,exe:basename(game.executablePath)};break;}
 }
 if(generation!==revision)return;
 if(!p.enabled||!tool||!target){stop();status=!p.enabled?"disabled":!tool?"missing-tool":"waiting-game";return;}
 if(activeKey===target.key&&child)return;
 stop();activeKey=target.key;status="starting";
 const display=screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
 const w=new BrowserWindow({x:display.bounds.x+16,y:display.bounds.y+16,width:100,height:26,transparent:true,frame:false,focusable:false,skipTaskbar:true,alwaysOnTop:true,resizable:false,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 overlay=w;w.setIgnoreMouseEvents(true);
 const html='<html><body style="margin:0;background:transparent"><div id="fps" style="display:inline-block;color:#d7d7d7;background:rgba(40,40,40,.78);border:1px solid rgba(255,255,255,.10);border-radius:3px;padding:3px 6px;font: 12px Arial,sans-serif;font-weight:500">FPS: --</div></body></html>';
 await w.loadURL("data:text/html;charset=utf-8,"+encodeURIComponent(html)).catch(()=>{});
 if(generation!==revision||overlay!==w||w.isDestroyed()){if(overlay===w)stop();return;}
 w.showInactive();
 const proc=spawn(tool,["--process_name",target.exe,"--output_stdout","--no_console_stats","--v1_metrics"],{windowsHide:true,stdio:["ignore","pipe","pipe"]});
 child=proc;status="measuring";
 let timeColumn=-1,chainColumn=-1,pidColumn=-1,applicationColumn=-1;
 const samples=new Map<string,{sum:number;count:number}>();
 const reader=createInterface({input:proc.stdout!});
 reader.on("line",line=>{
  const row=line.trim().replace(/^\uFEFF/,"").split(",");
  if(row.includes("MsBetweenPresents")){timeColumn=row.indexOf("MsBetweenPresents");chainColumn=row.indexOf("SwapChainAddress");pidColumn=row.indexOf("ProcessID");applicationColumn=row.indexOf("Application");return;}
  if(timeColumn<0||applicationColumn<0||row[applicationColumn]?.toLowerCase()!==target.exe.toLowerCase())return;
  const ms=Number(row[timeColumn]);if(!Number.isFinite(ms)||ms<=0||ms>10000)return;
  const key=row[pidColumn]+":"+row[chainColumn];const s=samples.get(key)??{sum:0,count:0};s.sum+=ms;s.count++;samples.set(key,s);
 });
 proc.stderr?.resume();
 timer=setInterval(()=>{const best=[...samples.values()].sort((a,b)=>b.count-a.count)[0];samples.clear();show(best?"FPS: "+Math.round(1000*best.count/best.sum):"FPS: --");},1000);
 const ended=()=>{if(child===proc){stop();status="capture-error";}};
 proc.once("error",ended);proc.once("exit",ended);
}
function refresh(){if(process.platform==="win32"&&app.isReady())void reconcile().catch(()=>{stop();status="capture-error";});}
ipcMain.handle("krysta:fps-preference",async()=> (await readPreference()).enabled===true);
ipcMain.handle("krysta:fps-set-preference",async(_event,enabled:unknown)=>{
 if(typeof enabled!=="boolean"||process.platform!=="win32")throw new Error("Invalid FPS preference");
 await savePreference({...await readPreference(),enabled});refresh();return enabled;
});
ipcMain.handle("krysta:fps-status",async()=>({available:!!await findTool(await readPreference()),status}));
ipcMain.handle("krysta:fps-select-tool",async()=>{
 if(process.platform!=="win32")return false;
 const result=await dialog.showOpenDialog({title:"Select official PresentMon console executable",properties:["openFile"],filters:[{name:"PresentMon",extensions:["exe"]}]});
 if(result.canceled||!result.filePaths[0])return false;
 const tool=result.filePaths[0];if(!/^presentmon.*\.exe$/i.test(basename(tool)))throw new Error("Select PresentMon executable");
 await savePreference({...await readPreference(),tool});refresh();return true;
});
if(process.platform==="win32"){onTrackedGamesRunningChange(refresh);void app.whenReady().then(refresh);app.on("before-quit",()=>{revision++;stop();});}
