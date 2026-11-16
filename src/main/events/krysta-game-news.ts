import { ipcMain, net } from "electron";

type News = { id: string; title: string; date: number; contents: string; url: string; author: string };
async function getNews(_event: Electron.IpcMainInvokeEvent, id: unknown, title: unknown) {
  let appId = typeof id === "string" && /^\d{1,10}$/.test(id) ? id : "";
  if (!appId && typeof title === "string" && title.trim()) {
    const q = new URL("https://store.steampowered.com/api/storesearch/");
    q.searchParams.set("term", title.slice(0,200)); q.searchParams.set("l","english"); q.searchParams.set("cc","US");
    const res = await net.fetch(q.toString(), {signal:AbortSignal.timeout(15000)});
    if(!res.ok) throw new Error("Steam search unavailable");
    const data = await res.json();
    const normalize = (s:string) => s.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g,"");
    const match = (Array.isArray(data.items) ? data.items : []).find((g:{name?:string;id?:number}) => typeof g.name==="string" && normalize(g.name)===normalize(title));
    if(match && /^\d{1,10}$/.test(String(match.id))) appId=String(match.id);
  }
  if(!appId) return {appId:null,items:[] as News[]};
  const url = new URL("https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/");
  url.searchParams.set("appid",appId); url.searchParams.set("count","30"); url.searchParams.set("maxlength","0"); url.searchParams.set("feeds","steam_community_announcements");
  const res=await net.fetch(url.toString(),{signal:AbortSignal.timeout(20000)});
  if(!res.ok) throw new Error("Steam news unavailable");
  const data=await res.json();
  const raw=data?.appnews?.newsitems;
  if(!Array.isArray(raw)) throw new Error("Invalid news response");
  const items:News[]=raw.filter((x:any)=>typeof x.title==="string" && typeof x.contents==="string").map((x:any)=>({id:String(x.gid),title:x.title,date:Number(x.date)||0,contents:x.contents.slice(0,60000),url:typeof x.url==="string"?x.url:"",author:String(x.author||"")}));
  return {appId,items};
}
ipcMain.handle("krysta:game-news",getNews);
