import {ipcMain} from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import {HydraApi} from "@main/services/hydra-api";
import {gamesSublevel} from "@main/level";
import {LocalSouvenirAssetStore,PendingGroupedSouvenirStore} from "@main/services/achievements/grouped-souvenir-store";

type Entry={id:string;gameKey:string;path:string;capturedAt:number;achievementNames:string[]};
type GalleryRow={id:string;gameTitle:string;path:string;capturedAt:number;achievementNames:string[]};
/** Read-only gallery index. Only media owned by the currently authenticated user is exposed. */
ipcMain.handle("krysta:souvenir-gallery",async():Promise<GalleryRow[]>=>{
 const context=HydraApi.getAuthContext();
 if(!HydraApi.isLoggedIn()||!context?.userId)return [];
 const ownerId=context.userId;
 const [assets,pending]=await Promise.all([LocalSouvenirAssetStore.list(),PendingGroupedSouvenirStore.list()]);
 const entries:Entry[]=[
  ...pending.filter(e=>e.ownerId===ownerId).map(e=>({
   id:"pending:"+e.clientId,gameKey:e.gameKey,path:e.screenshotPath,
   capturedAt:e.capturedAt,achievementNames:e.achievements.map(a=>a.name).slice(0,8)
  })),
  ...assets.filter(e=>e.ownerId===ownerId).map(e=>({
   id:"saved:"+e.souvenirId,gameKey:e.gameKey,path:e.screenshotPath,
   capturedAt:0,achievementNames:[]
  }))
 ];
 const seen=new Set<string>();
 const gameNames=new Map<string,Promise<string>>();
 const rows:GalleryRow[]=[];
 for(const entry of entries){
  if(rows.length>=500)break;
  if(!path.isAbsolute(entry.path)||!/[.]jpe?g$/i.test(entry.path))continue;
  const key=process.platform==="win32"?entry.path.toLowerCase():entry.path;
  if(seen.has(key))continue;
  const info=await fs.lstat(entry.path).catch(()=>null);
  if(!info?.isFile()||info.isSymbolicLink()||info.size===0||info.size>100*1024*1024)continue;
  seen.add(key);
  if(!gameNames.has(entry.gameKey)){
   gameNames.set(entry.gameKey,gamesSublevel.get(entry.gameKey).then(g=>g?.title??"").catch(()=>""));
  }
  const gameTitle=await gameNames.get(entry.gameKey)!;
  rows.push({
   id:entry.id,gameTitle:gameTitle||"Gra",path:entry.path,
   capturedAt:entry.capturedAt>0?entry.capturedAt:info.mtimeMs,
   achievementNames:entry.achievementNames
  });
 }
 if(!HydraApi.isAuthContextCurrent(context))return [];
 return rows.sort((a,b)=>b.capturedAt-a.capturedAt);
});