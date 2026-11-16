import { BrowserWindow, ipcMain, session, net } from "electron";
import { randomUUID } from "node:crypto";

const appId = "f68a4bb5-608a-4ff2-8123-be8ef797e0a6";
const origin = "https://connect.ubisoft.com";
type Account = { ticket: string; sessionId: string; userId: string; nameOnPlatform: string };
let account: Account | null = null;
let pending = false;
let lastSync: string | null = null;
let games: {id:string; title:string}[] = [];
const state = () => ({ connected: !!account, username: account?.nameOnPlatform ?? null, lastSync, games });
async function sync() {
  if (!account) throw new Error("Not connected");
  const current = account;
  const response = await net.fetch("https://public-ubiservices.ubi.com/v1/profiles/me/uplay/graphql", {
    method: "POST", redirect: "error",
    headers: {"Content-Type":"application/json", "Ubi-AppId":appId, "Ubi-SessionId":current.sessionId, Authorization:"Ubi_v1 t="+current.ticket},
    body: JSON.stringify({operationName:"AllGames", variables:{owned:true}, query:"query AllGames { viewer { ownedGames: games(filterBy: {isOwned: true}) { nodes { id name } } } }"})
  });
  if (!response.ok) throw new Error("Ubisoft API unavailable or session expired");
  const result = await response.json();
  const nodes = result?.data?.viewer?.ownedGames?.nodes;
  if (!Array.isArray(nodes) || account !== current) throw new Error("Invalid Ubisoft library response");
  games = nodes.filter((g: {id?:unknown;name?:unknown}) => typeof g?.id === "string" && typeof g?.name === "string").map((g:{id:string;name:string})=>({id:g.id,title:g.name}));
  lastSync = new Date().toISOString();
  return state();
}
ipcMain.handle("krysta:ubi-account-state", state);
ipcMain.handle("krysta:ubi-account-sync", sync);
ipcMain.handle("krysta:ubi-account-disconnect", () => { if(pending) throw new Error("Login in progress"); account=null; games=[]; lastSync=null; return state(); });
ipcMain.handle("krysta:ubi-account-connect", async () => {
  if (pending) throw new Error("Login in progress");
  pending=true;
  const authSession=session.fromPartition("krysta-ubi-"+randomUUID());
  const win=new BrowserWindow({width:460,height:690,title:"Ubisoft Connect",webPreferences:{session:authSession,nodeIntegration:false,contextIsolation:true,sandbox:true}});
  win.webContents.setWindowOpenHandler(()=>({action:"deny"}));
  let timer: ReturnType<typeof setInterval> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const data=await new Promise<Account>((resolve,reject)=>{
      let reading=false;
      win.once("closed",()=>reject(new Error("Login cancelled")));
      timeout=setTimeout(()=>reject(new Error("Login timed out")),300000);
      timer=setInterval(async()=>{
        if(reading || win.isDestroyed()) return;
        reading=true;
        try {
          if(new URL(win.webContents.getURL()).origin!==origin) return;
          const value=await win.webContents.executeJavaScript("location.origin === 'https://connect.ubisoft.com' ? localStorage.getItem('PRODloginData') : null");
          const v=JSON.parse(value || "null");
          if(v && ["ticket","sessionId","userId","nameOnPlatform"].every(k=>typeof v[k]==="string" && v[k])) resolve({ticket:v.ticket,sessionId:v.sessionId,userId:v.userId,nameOnPlatform:v.nameOnPlatform});
        } catch { /* login still in progress */ } finally { reading=false; }
      },700);
      void win.loadURL(origin+"/login?appId="+appId+"&genomeId=954e66a0-be1b-4aa0-9690-fb75201e4e9e&lang=en-US&nextUrl=https%3A%2F%2Fconnect.ubisoft.com%2F").catch(reject);
    });
    account=data;
    try { return await sync(); } catch { account=null; games=[]; lastSync=null; throw new Error("Could not verify Ubisoft account"); }
  } finally {
    if(timer) clearInterval(timer);
    if(timeout) clearTimeout(timeout);
    if(!win.isDestroyed()) win.destroy();
    await authSession.clearStorageData().catch(()=>{});
    pending=false;
  }
});
