import {test} from "node:test";
import assert from "node:assert/strict";
import {mergePublishedPatches,providerStatusIsStale} from "./game-update-patch-history.js";
test("patch timeline deduplicates, orders and preserves older posts",()=>{
 const now=Date.UTC(2026,10,17);
 const old={id:"first",title:"Patch 1",date:(now-100000)/1000},latest={id:"latest",title:"Patch 2",date:(now-50000)/1000};
 const entries=mergePublishedPatches(undefined,[old,latest,old],now);
 assert.deepEqual(entries.map(e=>e.id),["latest","first"]);
 assert.deepEqual(mergePublishedPatches(entries,[latest],now).map(e=>e.id),["latest","first"]);
 assert.deepEqual(mergePublishedPatches(entries,[],now,1).map(e=>e.id),["latest"]);
});
test("rejects invalid news metadata and future dates",()=>{
 const now=Date.UTC(2026,10,17);
 assert.deepEqual(mergePublishedPatches(undefined,[{id:"future",title:"Patch",date:now/1000+100000},{id:"blank",title:"",date:now/1000},{id:"nan",title:"bad",date:NaN}],now),[]);
});
test("stale platform status is distinguishable from current information",()=>{
 const now=Date.UTC(2026,10,17);
 assert.equal(providerStatusIsStale(new Date(now-3600000).toISOString(),now),false);
 assert.equal(providerStatusIsStale(new Date(now-37*3600000).toISOString(),now),true);
 assert.equal(providerStatusIsStale(undefined,now),true);
 assert.equal(providerStatusIsStale("bad",now),true);
});

test("empty feeds preserve stored patch history",()=>{
 const now=Date.UTC(2026,10,17),entry={id:"first",title:"Patch 1",publishedAt:new Date(now-100000).toISOString()};
 assert.deepEqual(mergePublishedPatches([entry],[],now),[entry]);
});
test("five minute future-clock tolerance for provider check",()=>{
 const now=Date.UTC(2026,10,17);
 assert.equal(providerStatusIsStale(new Date(now+4*60000).toISOString(),now),false);
 assert.equal(providerStatusIsStale(new Date(now+6*60000).toISOString(),now),true);
});
