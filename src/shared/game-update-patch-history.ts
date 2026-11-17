/** A published patch announcement does not prove an update can be installed. */
export type PatchAnnouncement={id:string;title:string;publishedAt:string};
type FeedPost={id:string;title:string;date:number};
export function mergePublishedPatches(previous:readonly PatchAnnouncement[]|undefined,feed:readonly FeedPost[],now=Date.now(),max=80):PatchAnnouncement[]{
 const items=new Map<string,PatchAnnouncement>();
 const add=(p:PatchAnnouncement)=>{
  if(typeof p.id!=="string"||!p.id||p.id.length>150||typeof p.title!=="string"||!p.title.trim()||p.title.length>500||typeof p.publishedAt!=="string")return;
  const t=Date.parse(p.publishedAt);
  if(!Number.isFinite(t)||t<Date.UTC(2000,0,1)||t>now+86400000)return;
  if(!items.has(p.id))items.set(p.id,p);
 };
 for(const post of feed){
  if(typeof post.id!=="string"||typeof post.title!=="string"||!Number.isFinite(post.date))continue;
  const time=post.date*1000;
  if(time<Date.UTC(2000,0,1)||time>now+86400000)continue;
  add({id:post.id,title:post.title.trim().slice(0,500),publishedAt:new Date(time).toISOString()});
 }
 for(const item of previous??[])add(item);
 return [...items.values()].sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)||a.id.localeCompare(b.id)).slice(0,Math.max(0,Math.min(max,100)));
}
export function providerStatusIsStale(checkedAt:string|undefined,now=Date.now(),maxHours=36){
 if(!checkedAt)return true;
 const t=Date.parse(checkedAt);
 return !Number.isFinite(t)||t>now+5*60000||now-t>maxHours*3600000;
}

/**
 * These are announcements, not evidence that the user's installed version
 * is behind. Only the installed client's update status can prove that.
 */
export function isLikelyGamePatchAnnouncement(title: string, tags?: unknown): boolean {
  const sourceTags=Array.isArray(tags)?tags.map(tag=>String(tag).toLowerCase()):[];
  if(sourceTags.some(tag=>/^(?:patchnotes|patch[_-]?notes|hotfix|release[_-]?notes|changelog|bugfix)$/.test(tag)))return true;
  if(!title||title.length>500)return false;
  // Do not match generic "development update" or "community update".
  return /\b(?:patch(?:\s+notes)?|hotfix(?:es)?|release\s+notes|changelog|change\s+log|bug\s*fix(?:es)?|game\s+update|major\s+update|content\s+update|new\s+update|update\s+(?:v?\d+(?:\.\d+)+|#\d+|released|available)|version\s+v?\d+(?:\.\d+)+)\b/i.test(title)
    || /(?:lista zmian|poprawki błędów|łatka|nowa aktualizacja|aktualizacja\s+v?\d+(?:\.\d+)+)/i.test(title);
}

/** A version parsed from a patch title is an announced version, never an
 * installed build or a store-confirmed update. Date-like tokens are ignored.
 */
export function announcedGamePatchVersion(title: string): string | null {
  if(!isLikelyGamePatchAnnouncement(title))return null;
  const match=title.match(/\b(?:patch(?:\s+notes)?|hotfix|update|version|wersja|aktualizacja)\s*(?:#|nr\.?\s*)?v?(\d+(?:\.\d+){1,4})\b/i)
    ??title.match(/(?:^|[\s:—–-])v(\d+(?:\.\d+){1,4})\b/i);
  if(!match)return null;
  const version=match[1];
  const major=Number(version.split(".")[0]);
  return major>=2000&&major<=2100?null:version;
}
