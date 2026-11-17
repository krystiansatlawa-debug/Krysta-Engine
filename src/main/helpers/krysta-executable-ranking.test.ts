import {test} from "node:test";
import assert from "node:assert/strict";
import {rankKrystaExecutableSuggestions as rank,chooseKrystaAutomaticExecutable as pick} from "./krysta-executable-ranking.js";
test("exact game executable is favored over setup or crash helpers",()=>{
 const candidates=rank(["setup.exe","_CommonRedist/vcredist_x64.exe","bin/Cyberpunk2077.exe","bin/crashreport.exe"],"Cyberpunk 2077");
 assert.deepEqual(candidates.map(x=>x.relativePath),["bin/Cyberpunk2077.exe"]);
 assert.equal(pick(candidates),"bin/Cyberpunk2077.exe");
});
test("ambiguous equally matched games never auto bind",()=>{
 const choices=rank(["bin/MetroExodus.exe","alternate/MetroExodus.exe"],"Metro Exodus");
 assert.equal(pick(choices),null);
});
test("unknown executable requires user confirmation",()=>{
 const candidates=rank(["GameClient.exe"],"Unrelated Game");
 assert.equal(pick(candidates),null);
});
test("known game executable can be picked without matching product display name",()=>{
 const candidates=rank(["Bin/witcher3.exe","setup.exe"],"The Witcher 3 Wild Hunt",[{exe:"witcher3.exe",name:"bin/witcher3.exe"}]);
 assert.equal(pick(candidates),"Bin/witcher3.exe");
});

test("common title acronyms find their proper main executables without network metadata",()=>{
 const redDead=rank(["RDR2.exe","Launcher.exe","setup.exe"],"Red Dead Redemption 2");
 assert.equal(pick(redDead),"RDR2.exe");
 const gta=rank(["GTA5.exe","GTAVLauncher.exe","CrashReporter.exe"],"Grand Theft Auto V");
 assert.equal(pick(gta),"GTA5.exe");
 const cod=rank(["CoDWaW.exe","unins000.exe"],"Call of Duty World at War");
 assert.equal(pick(cod),"CoDWaW.exe");
});
test("short ambiguous abbreviations cannot trigger automatic linking",()=>{
 assert.equal(pick(rank(["nw.exe"],"New World")),null);
 assert.equal(pick(rank(["RDR2.exe","bin/RDR2.exe"],"Red Dead Redemption 2")),null);
});
