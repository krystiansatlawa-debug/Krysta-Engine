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
