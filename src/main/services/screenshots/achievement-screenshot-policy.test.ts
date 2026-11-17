import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isAchievementScreenshotEnabled as enabled,
  isAchievementScreenshotTarget as matches,
} from "./achievement-screenshot-policy.js";

test("achievement screenshots are off by default and independent of video recording",()=>{
  assert.equal(enabled(null),false);
  assert.equal(enabled({screenshotsEnabled:true,screenshotOnAchievementEnabled:false}),false);
  assert.equal(enabled({screenshotsEnabled:true,screenshotOnAchievementEnabled:true}),true);
  assert.equal(enabled({screenshotsEnabled:false,screenshotOnAchievementEnabled:true}),false);
  assert.equal(enabled({screenshotOnAchievementEnabled:true}),true);
});

test("never capture another game or desktop when an achievement arrives",()=>{
  assert.equal(matches({status:"resolved",target:{gameKey:"steam:620"}},"steam:620"),true);
  assert.equal(matches({status:"resolved",target:{gameKey:"steam:570"}},"steam:620"),false);
  assert.equal(matches({status:"unresolved"},"steam:620"),false);
  assert.equal(matches({status:"resolved"},"steam:620"),false);
});
