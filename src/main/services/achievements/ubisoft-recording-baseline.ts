export type UbisoftRecordingBaseline={
 scope:string;
 observedAt:number;
 unlocked:ReadonlySet<string>;
};
type Achievement={id:string;title:string;unlocked:boolean};
export function advanceUbisoftRecordingBaseline(previous:UbisoftRecordingBaseline|null,scope:string,items:readonly Achievement[],now:number){
 const unlocked=new Set(items.filter(item=>item.unlocked).map(item=>item.id));
 const continuous=previous!==null&&previous.scope===scope&&now>=previous.observedAt&&now-previous.observedAt<=45000;
 const newTitles=continuous?items.filter(item=>item.unlocked&&!previous.unlocked.has(item.id)).map(item=>item.title):[];
 // Keep seen unlocks even if the service later reports an achievement as locked.
 const seen=continuous?new Set([...previous.unlocked,...unlocked]):unlocked;
 return {baseline:{scope,observedAt:now,unlocked:seen},newTitles};
}
