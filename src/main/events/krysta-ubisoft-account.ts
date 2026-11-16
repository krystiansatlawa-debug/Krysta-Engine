import { BrowserWindow, ipcMain, session, net, app, safeStorage } from "electron";
import { gamesSublevel, gamesShopAssetsSublevel, levelKeys } from "@main/level";
import { readFileSync, writeFileSync, rmSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";

const appId = "f68a4bb5-608a-4ff2-8123-be8ef797e0a6";
const origin = "https://connect.ubisoft.com";
type Account = { ticket: string; sessionId: string; userId: string; nameOnPlatform: string; rememberMeTicket?: string };
let account: Account | null = null;
let pending = false;
let lastSync: string | null = null;
let games: {id:string; title:string}[] = [];
const sessionPath = () => join(app.getPath("userData"), "ubisoft-session.enc");
let restored = false;
function restore() {
  if (restored) return;
  restored = true;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const saved = JSON.parse(safeStorage.decryptString(readFileSync(sessionPath())));
      if (saved.account?.ticket && saved.account?.userId) { account = saved.account; lastSync = saved.lastSync ?? null; }
    }
  } catch { /* no saved session */ }
}
function persist() {
  if (!account || !safeStorage.isEncryptionAvailable()) return;
  try {
    const tmp = sessionPath() + ".tmp";
    writeFileSync(tmp, safeStorage.encryptString(JSON.stringify({ account, lastSync })), { mode: 0o600 });
    renameSync(tmp, sessionPath());
  } catch { /* session remains in memory */ }
}
const state = () => ({ connected: !!account, username: account?.nameOnPlatform ?? null, lastSync, games });
async function sync() {
  restore();
  if (!account) throw new Error("Not connected");
  const current = account;
  const request = () => net.fetch("https://public-ubiservices.ubi.com/v1/profiles/me/uplay/graphql", {
    method: "POST", redirect: "error",
    headers: {"Content-Type":"application/json", "Ubi-AppId":appId, "Ubi-SessionId":current.sessionId, Authorization:"Ubi_v1 t="+current.ticket},
    body: JSON.stringify({operationName:"AllGames", variables:{owned:true}, query:"query AllGames { viewer { ownedGames: games(filterBy: {isOwned: true}) { nodes { id name } } } }"})
  });
  let response = await request();
  if (response.status === 401 || response.status === 403) {
    const refreshed = await net.fetch("https://public-ubiservices.ubi.com/v3/profiles/sessions", {
      method: current.rememberMeTicket ? "POST" : "PUT", redirect:"error",
      headers: {"Content-Type":"application/json","Ubi-AppId":appId, Authorization: current.rememberMeTicket ? "rm_v1 t="+current.rememberMeTicket : "Ubi_v1 t="+current.ticket},
      ...(current.rememberMeTicket ? {body:JSON.stringify({rememberMe:true})} : {})
    });
    if (!refreshed.ok) {
      if (account === current && (refreshed.status === 401 || refreshed.status === 403)) { rmSync(sessionPath(),{force:true}); account=null; lastSync=null; games=[]; }
      throw new Error("Ubisoft session could not refresh");
    }
    const next = await refreshed.json();
    if (account !== current || next.userId !== current.userId || typeof next.ticket !== "string" || typeof next.sessionId !== "string") throw new Error("Invalid session");
    current.ticket=next.ticket; current.sessionId=next.sessionId;
    if(typeof next.rememberMeTicket==="string") current.rememberMeTicket=next.rememberMeTicket;
    persist();
    response=await request();
  }
  if (!response.ok) throw new Error("Ubisoft API unavailable or session expired");
  const result = await response.json();
  const nodes = result?.data?.viewer?.ownedGames?.nodes;
  if (!Array.isArray(nodes) || account !== current) throw new Error("Invalid Ubisoft library response");
  games = nodes.filter((g: {id?:unknown;name?:unknown}) => typeof g?.id === "string" && typeof g?.name === "string").map((g:{id:string;name:string})=>({id:g.id,title:g.name}));
  const existing = await gamesSublevel.iterator().all();
  const keys = new Set(existing.map(([key]) => key));
  for (const item of games) {
    if(account !== current) throw new Error("Account changed");
    const shop = "custom" as const;
    const objectId = "ubi-owned-" + createHash("sha256").update(current.userId + ":" + item.id).digest("hex").slice(0,32);
    const key = levelKeys.game(shop, objectId);
    if(keys.has(key)) continue;
    await gamesShopAssetsSublevel.put(key, {
      updatedAt:Date.now(),objectId,shop,title:item.title,iconUrl:null,libraryHeroImageUrl:"",libraryImageUrl:"",logoImageUrl:"",logoPosition:null,coverImageUrl:"",downloadSources:[]
    });
    await gamesSublevel.put(key,{
      title:item.title,iconUrl:null,logoImageUrl:null,libraryHeroImageUrl:null,objectId,shop,remoteId:null,isDeleted:false,playTimeInMilliseconds:0,lastTimePlayed:null,addedToLibraryAt:new Date(),executablePath:null,launchOptions:null,favorite:false,automaticCloudSync:false,hasManuallyUpdatedPlaytime:false
    });
    keys.add(key);
  }
  lastSync = new Date().toISOString();
  persist();
  return state();
}
ipcMain.handle("krysta:ubi-account-state", () => {restore(); return state();});
ipcMain.handle("krysta:ubi-account-sync", sync);
ipcMain.handle("krysta:ubi-account-disconnect", () => { if(pending) throw new Error("Login in progress"); restored=true; rmSync(sessionPath(),{force:true}); account=null; games=[]; lastSync=null; return state(); });
ipcMain.handle("krysta:ubi-account-connect", async () => {
  if (pending) throw new Error("Login in progress");
  restore();
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
          if(v && ["ticket","sessionId","userId","nameOnPlatform"].every(k=>typeof v[k]==="string" && v[k])) resolve({ticket:v.ticket,sessionId:v.sessionId,userId:v.userId,nameOnPlatform:v.nameOnPlatform, rememberMeTicket:typeof v.rememberMeTicket==="string" ? v.rememberMeTicket : undefined});
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
