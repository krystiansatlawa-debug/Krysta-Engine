import { test } from "node:test";
import assert from "node:assert/strict";
import { hasNewFolderAchievements } from "./has-new-folder-achievements.js";
test("newly discovered folder with earned achievements is not silently skipped",()=>{
 assert.equal(hasNewFolderAchievements(undefined,new Set(["ACH_A"])),true);
 assert.equal(hasNewFolderAchievements(undefined,new Set()),false);
});
test("repeat scan skips unchanged folder but detects additions",()=>{
 const baseline=new Set(["ACH_A"]);
 assert.equal(hasNewFolderAchievements(baseline,new Set(["ACH_A"])),false);
 assert.equal(hasNewFolderAchievements(baseline,new Set(["ACH_A","ACH_B"])),true);
 assert.equal(hasNewFolderAchievements(baseline,new Set()),false);
});
