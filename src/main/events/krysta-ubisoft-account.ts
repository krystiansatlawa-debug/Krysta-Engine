import { BrowserWindow, ipcMain, session, net, app, safeStorage } from "electron";
import { gamesSublevel, gamesShopAssetsSublevel, levelKeys } from "@main/level";
import { readFileSync, writeFileSync, rmSync, renameSync } from "node:fs";
import { join } from "node:path";
import { getGameAssets } from "./catalogue/get-game-assets";
import { updateGameRecord } from "@main/services/game-record-updater";
import { scanUbisoft, findUbisoftExecutable } from "./krysta-ubisoft";
import { randomUUID, createHash } from "node:crypto";

const appId = "f68a4bb5-608a-4ff2-8123-be8ef797e0a6";
const origin = "https://connect.ubisoft.com";
type Account = { ticket: string; sessionId: string; userId: string; nameOnPlatform: string; rememberMeTicket?: string };
let account: Account | null = null;
let pending = false;
let lastSync: string | null = null;
type OwnedGame={id:string;title:string;spaceId?:string};
type UbisoftAchievement={id:string;title:string;description:string;icon:string|null;unlocked:boolean;completionDate:string|null};
type AchievementSnapshot={items:UbisoftAchievement[];total:number;completed:number;updatedAt:string};
let games:OwnedGame[] = [];
const achievementCache=new Map<string,AchievementSnapshot>();
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let accountQueue:Promise<unknown>=Promise.resolve();
function serialized<T>(fn:()=>Promise<T>):Promise<T>{
 const task=accountQueue.then(fn,fn);accountQueue=task.catch(()=>{});return task;
}
const cleanTitle=(s:string)=>s.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g,"");

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
async function graphRequest(operationName:string,query:string) {
  restore();
  if (!account) throw new Error("Not connected");
  const current = account;
  const request = () => net.fetch("https://public-ubiservices.ubi.com/v1/profiles/me/uplay/graphql", {
    method: "POST", redirect: "error",
    headers: {"Content-Type":"application/json", "Ubi-AppId":appId, "Ubi-SessionId":current.sessionId,"Ubi-LocaleCode":"en-US", Authorization:"Ubi_v1 t="+current.ticket},
    signal:AbortSignal.timeout(20000),
    body:JSON.stringify({operationName,variables:{},query})
  });
  let response = await request();
  let result=await response.json().catch(()=>null);
  if (response.status === 401 || response.status === 403 || result?.errors?.some((e:{extensions?:{code?:string}})=>e.extensions?.code==="INVALID_TICKET")) {
    const refreshed = await net.fetch("https://public-ubiservices.ubi.com/v3/profiles/sessions", {
      method: current.rememberMeTicket ? "POST" : "PUT", redirect:"error",signal:AbortSignal.timeout(20000),
      headers: {"Content-Type":"application/json","Ubi-AppId":appId, Authorization: current.rememberMeTicket ? "rm_v1 t="+current.rememberMeTicket : "Ubi_v1 t="+current.ticket},
      ...(current.rememberMeTicket ? {body:JSON.stringify({rememberMe:true})} : {})
    });
    if (!refreshed.ok) {
      if (account === current && (refreshed.status === 401 || refreshed.status === 403)) { rmSync(sessionPath(),{force:true}); account=null; lastSync=null; games=[]; achievementCache.clear(); }
      throw new Error("Ubisoft session could not refresh");
    }
    const next = await refreshed.json();
    if (account !== current || next.userId !== current.userId || typeof next.ticket !== "string" || typeof next.sessionId !== "string") throw new Error("Invalid session");
    current.ticket=next.ticket; current.sessionId=next.sessionId;
    if(typeof next.rememberMeTicket==="string") current.rememberMeTicket=next.rememberMeTicket;
    persist();
    response=await request();result=await response.json().catch(()=>null);
  }
  if (!response.ok||!result||result.errors?.length||account!==current) throw new Error("Ubisoft service did not return authorized data; reconnect or try again later.");
  return result.data;
}
async function loadOwnedGames(){
 const current=account;
 const data=await graphRequest("AllGames","query AllGames { viewer { ownedGames: games(filterBy: {isOwned: true}) { nodes { id name spaceId } } } }");
 const nodes=data?.viewer?.ownedGames?.nodes;
  if (!Array.isArray(nodes) || account !== current) throw new Error("Invalid Ubisoft library response");
  games = nodes.filter((g: {id?:unknown;name?:unknown}) => typeof g?.id === "string" && typeof g?.name === "string").map((g:{id:string;name:string;spaceId?:unknown})=>({id:g.id,title:g.name,spaceId:typeof g.spaceId==="string"&&uuid.test(g.spaceId)?g.spaceId:undefined}));
  return games;
}
async function syncInternal(){
  restore();const current=account;if(!current)throw Error("Not connected");
  await loadOwnedGames();
  const existing = await gamesSublevel.iterator().all();
  const records = new Map(existing);
  const local = await scanUbisoft();
  const norm=(s:string)=>s.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g,"");
  for (const item of games) {
    if(account !== current) throw new Error("Account changed");
    const shop = "custom" as const;
    const objectId = "ubi-owned-" + createHash("sha256").update(current.userId + ":" + item.id).digest("hex").slice(0,32);
    const key = levelKeys.game(shop, objectId);
    const old=records.get(key);
    const oldAssets=await gamesShopAssetsSublevel.get(key);
    const matches=local.games.filter(g=>norm(g.title)===norm(item.title));
    const installed=matches.length===1?matches[0]:null;
    const exe=installed?findUbisoftExecutable(installed.path,item.title):null;
    let catalogueGame=old?.catalogueGame;
    let cover=oldAssets?.coverImageUrl??"",hero=oldAssets?.libraryHeroImageUrl??"";
    if(!catalogueGame||!cover||!hero){
      try{
        const url=new URL("https://store.steampowered.com/api/storesearch/");
        url.searchParams.set("term",item.title);url.searchParams.set("l","english");url.searchParams.set("cc","US");
        const response=await net.fetch(url.toString(),{signal:AbortSignal.timeout(7000)});
        if(response.ok){
          const data=await response.json();
          const candidates=(Array.isArray(data.items)?data.items:[]).filter((g:{name?:string;id?:number})=>typeof g.name==="string"&&norm(g.name)===norm(item.title)&&/^\d+$/.test(String(g.id)));
          if(candidates.length===1){
            const steamId=String(candidates[0].id);
            const assets=await getGameAssets(steamId,"steam").catch(()=>null);
            if(assets&&norm(assets.title)===norm(item.title)) catalogueGame={shop:"steam",objectId:steamId};
            const prefix="https://cdn.cloudflare.steamstatic.com/steam/apps/"+steamId+"/";
            cover=cover||prefix+"library_600x900.jpg";hero=hero||prefix+"library_hero.jpg";
          }
        }
      }catch{/* artwork not available */}
    }
    await gamesShopAssetsSublevel.put(key, {
      updatedAt:Date.now(),objectId,shop,title:item.title,iconUrl:null,libraryHeroImageUrl:hero,libraryImageUrl:cover,logoImageUrl:"",logoPosition:null,coverImageUrl:cover,downloadSources:[],...oldAssets,
      ...(cover?{coverImageUrl:cover,libraryImageUrl:cover}:{}),...(hero?{libraryHeroImageUrl:hero}:{})
    });
    if(account!==current)throw Error("Account changed");
    const patch={...(catalogueGame?{catalogueGame}:{}),...(exe&&!old?.executablePath?{executablePath:exe,executablePathUpdatedAt:new Date()}:{}),...(installed?{ubisoftInstallPath:installed.path,ubisoftLauncherId:installed.id}:{})};
    if(old){await updateGameRecord(key,patch);continue;}
    await gamesSublevel.put(key,{
      title:item.title,iconUrl:null,logoImageUrl:null,libraryHeroImageUrl:hero||null,objectId,shop,remoteId:null,isDeleted:false,playTimeInMilliseconds:0,lastTimePlayed:null,addedToLibraryAt:new Date(),executablePath:null,launchOptions:null,favorite:false,automaticCloudSync:false,hasManuallyUpdatedPlaytime:false,
      ...patch
    });

  }
  lastSync = new Date().toISOString();
  persist();
  return state();
}
function sync(){return serialized(syncInternal);}

async function getUbisoftAchievementsInternal(objectId:unknown,force:boolean){
 restore();const current=account;if(!current)throw Error("Connect Ubisoft account first");
 if(typeof objectId!=="string"||!(/^(?:ubi-owned-[a-f0-9]{32}|ubisoft-\d+)$/.test(objectId)))throw Error("Invalid Ubisoft game");
 const game=await gamesSublevel.get(levelKeys.game("custom",objectId));if(!game||game.isDeleted)throw Error("Game not found");
 if(!games.length)await loadOwnedGames();
 const ownedId=(id:string)=>"ubi-owned-"+createHash("sha256").update(current.userId+":"+id).digest("hex").slice(0,32);
 const matches=games.filter(g=>objectId.startsWith("ubi-owned-")?ownedId(g.id)===objectId:cleanTitle(game.title)===cleanTitle(g.title));
 const spaceIds=[...new Set(matches.map(g=>g.spaceId).filter((v):v is string=>!!v))];
 if(spaceIds.length!==1)throw Error("No unique Ubisoft game ID; synchronize the library first.");
 const spaceId=spaceIds[0],cacheKey=current.userId+":"+spaceId,cached=achievementCache.get(cacheKey);
 if(!force&&cached&&Date.now()-Date.parse(cached.updatedAt)<60000)return cached;
 const data=await graphRequest("GetAchievements",`query GetAchievements { game(spaceId: ${JSON.stringify(spaceId)}) { id viewer { meta { id achievements { totalCount completedCount nodes { id achievementId title description icon viewer { meta { id completionDate isCompleted } } } } } } } }`);
 if(account!==current)throw Error("Account changed");
 const set=data?.game?.viewer?.meta?.achievements;
 if(!set||!Array.isArray(set.nodes)||!Number.isInteger(set.totalCount)||!Number.isInteger(set.completedCount)||set.totalCount<0||set.completedCount<0||set.completedCount>set.totalCount||set.nodes.length!==set.totalCount||set.nodes.length>2000)throw Error("Ubisoft achievement data unavailable or incomplete");
 const items:UbisoftAchievement[]=[],ids=new Set<string>();
 for(const node of set.nodes){
  const meta=node?.viewer?.meta;
  if(typeof node?.id!=="string"||ids.has(node.id)||typeof node.title!=="string"||typeof meta?.isCompleted!=="boolean")throw Error("Incomplete Ubisoft achievement entry");
  ids.add(node.id);let icon:string|null=null;
  try{const u=new URL(node.icon);if(u.protocol==="https:"&&u.hostname==="ubiservices.cdn.ubi.com")icon=u.href;}catch{}
  items.push({id:node.id,title:node.title.slice(0,500),description:typeof node.description==="string"?node.description.slice(0,4000):"",icon,unlocked:meta.isCompleted,completionDate:meta.isCompleted&&typeof meta.completionDate==="string"&&Number.isFinite(Date.parse(meta.completionDate))?meta.completionDate:null});
 }
 if(items.filter(i=>i.unlocked).length!==set.completedCount)throw Error("Ubisoft achievement totals do not match");
 const snapshot={items,total:set.totalCount,completed:set.completedCount,updatedAt:new Date().toISOString()};
 achievementCache.set(cacheKey,snapshot);return snapshot;
}
ipcMain.handle("krysta:ubi-achievements",(_e,id:unknown,force:unknown)=>serialized(()=>getUbisoftAchievementsInternal(id,force===true)));
ipcMain.handle("krysta:ubi-account-state", () => {restore(); return state();});
ipcMain.handle("krysta:ubi-account-sync", sync);
ipcMain.handle("krysta:ubi-account-disconnect", () => { if(pending) throw new Error("Login in progress"); restored=true; rmSync(sessionPath(),{force:true}); account=null; games=[]; lastSync=null; achievementCache.clear(); return state(); });
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
    return await serialized(async()=>{ account=data;games=[];achievementCache.clear();
      try { return await syncInternal(); } catch { account=null; games=[]; lastSync=null; achievementCache.clear(); throw new Error("Could not verify Ubisoft account"); }
    });
  } finally {
    if(timer) clearInterval(timer);
    if(timeout) clearTimeout(timeout);
    if(!win.isDestroyed()) win.destroy();
    await authSession.clearStorageData().catch(()=>{});
    pending=false;
  }
});
