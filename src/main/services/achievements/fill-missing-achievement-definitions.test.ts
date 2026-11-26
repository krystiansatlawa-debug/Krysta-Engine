import { test } from "node:test";
import assert from "node:assert/strict";
import { fillMissingAchievementDefinitions as fill } from "./fill-missing-achievement-definitions.js";
import type { SteamAchievement, UnlockedAchievement } from "@types";

const base: SteamAchievement = {name:"ACH_ONE",displayName:"First Achievement",description:"Do the first thing",icon:"icon",icongray:"grey",hidden:false};
const earned=(name:string):UnlockedAchievement=>({name,unlockTime:1730000000000});

test("catalogue remains untouched when no unlock is detected",()=>{
 const original=[base];assert.equal(fill(original,[]),original);
});
test("unmatched but genuinely earned achievement becomes visible with technical ID",()=>{
 const original=[base],filled=fill(original,[earned("ach_one"),earned("ACH_TWO"),earned("ach_two")]);
 assert.equal(original.length,1);assert.equal(filled.length,2);
 assert.equal(filled[0],base);
 assert.deepEqual(filled[1],{name:"ACH_TWO",displayName:"ACH_TWO",description:"",icon:"",icongray:"",hidden:false});
});
test("unknown catalogue is not treated as proof of an unlock",()=>{
 assert.deepEqual(fill([],[]),[]);
 assert.equal(fill([], [earned("ACH_FIRST")]).length,1);
});
