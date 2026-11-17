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
