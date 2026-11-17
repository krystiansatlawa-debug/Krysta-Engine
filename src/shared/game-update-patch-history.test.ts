import {test} from "node:test";
import assert from "node:assert/strict";
import {mergePublishedPatches,providerStatusIsStale,isLikelyGamePatchAnnouncement,announcedGamePatchVersion,isRecentGamePatchAnnouncement} from "./game-update-patch-history.js";
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

test("identifies patch announcements without confusing generic community updates",()=>{
 for(const title of [
  "Update 1.3.2 is now live",
  "New Update: major gameplay fixes",
  "Patch Notes for Version 2.15",
  "Hotfix 1.06",
  "Content Update - Season 3",
  "Lista zmian: aktualizacja 1.7",
  "v1.8.7 Hotfix",
  "Naprawy — poprawki błędów",
 ])assert.equal(isLikelyGamePatchAnnouncement(title),true,title);
 for(const title of ["Development update", "Community update", "Upcoming events", "Weekly roundup", "Update on our team"])assert.equal(isLikelyGamePatchAnnouncement(title),false,title);
 assert.equal(isLikelyGamePatchAnnouncement("Spring announcement",["patch_notes"]),true);
 assert.equal(isLikelyGamePatchAnnouncement("Spring announcement",["news"]),false);
});
test("extracts announced versions but never treats dates or news as installed updates",()=>{
 assert.equal(announcedGamePatchVersion("Patch Notes for Version 2.15"),"2.15");
 assert.equal(announcedGamePatchVersion("Hotfix 1.06"),"1.06");
 assert.equal(announcedGamePatchVersion("Update v1.2.3 released"),"1.2.3");
 assert.equal(announcedGamePatchVersion("Community update 1.2.3"),null);
 assert.equal(announcedGamePatchVersion("Update 2026.11.17"),null);
 assert.equal(announcedGamePatchVersion("New Update: improvements"),null);
 assert.equal(announcedGamePatchVersion("v1.8.7 Hotfix"),"1.8.7");
});

test("recent patch alerts exclude old posts while the patch history keeps them",()=>{
 const now=Date.UTC(2026,10,17);
 assert.equal(isRecentGamePatchAnnouncement((now-2*86400000)/1000,now),true);
 assert.equal(isRecentGamePatchAnnouncement((now-31*86400000)/1000,now),false);
 assert.equal(isRecentGamePatchAnnouncement((now+2*86400000)/1000,now),false);
 assert.equal(isRecentGamePatchAnnouncement(NaN,now),false);
 const old={id:"old",title:"Patch 1.2",date:(now-45*86400000)/1000};
 assert.deepEqual(mergePublishedPatches(undefined,[old],now).map(p=>p.id),["old"]);
});
