import assert from "node:assert/strict";
import {test} from "node:test";
import {AchievementFileObservationTracker} from "./achievement-file-observation-tracker.js";

test("shared achievement files are observed independently per game",()=>{
 const tracker=new AchievementFileObservationTracker(),stat={mtimeMs:1234,size:200};
 assert.equal(tracker.fileChanged("steam:111","shared.json",stat),true);
 assert.equal(tracker.fileChanged("steam:222","shared.json",stat),true);
 assert.equal(tracker.fileChanged("steam:111","shared.json",stat),false);
 assert.equal(tracker.fileChanged("steam:222","shared.json",stat),false);
});
test("same-mtime size changes are detected",()=>{
 const tracker=new AchievementFileObservationTracker();
 tracker.seedFile("steam:111","achievements.ini",{mtimeMs:1234,size:200});
 assert.equal(tracker.fileChanged("steam:111","achievements.ini",{mtimeMs:1234,size:201}),true);
 assert.equal(tracker.fileChanged("steam:111","achievements.ini",{mtimeMs:1234,size:201}),false);
});
test("folder observations include initial achievements and changes independently",()=>{
 const tracker=new AchievementFileObservationTracker();
 assert.equal(tracker.folderChanged("steam:111","trophies",["one"]),true);
 assert.equal(tracker.folderChanged("steam:222","trophies",["one"]),true);
 assert.equal(tracker.folderChanged("steam:111","trophies",["one"]),false);
 assert.equal(tracker.folderChanged("steam:111","trophies",["one","two"]),true);
 assert.equal(tracker.folderChanged("steam:222","trophies",["one","two"]),true);
});
test("failed merge can reset only the affected game's observation",()=>{
 const tracker=new AchievementFileObservationTracker();
 const stat={mtimeMs:100,size:20};
 tracker.seedFile("steam:111","shared.ini",stat);
 tracker.seedFile("steam:222","shared.ini",stat);
 tracker.forget("steam:111","shared.ini");
 assert.equal(tracker.fileChanged("steam:111","shared.ini",stat),true);
 assert.equal(tracker.fileChanged("steam:222","shared.ini",stat),false);
});
