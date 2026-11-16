import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readKrystaSettings, writeKrystaSettings, repairKrystaSettings } from "./krysta-settings-recovery";

test("settings recovery never modifies unrelated application data", async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"krysta-repair-"));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const file=path.join(root,"krysta-fps.json");
 const library=path.join(root,"library");
 await fs.writeFile(library,"untouched");
 await writeKrystaSettings(root,"fps",{enabled:true,position:"tr"});
 await fs.writeFile(file,"{broken");
 const results=await repairKrystaSettings(root);
 assert.equal(results.find(x=>x.name==="fps")?.state,"restored");
 assert.equal((await readKrystaSettings<{enabled:boolean}>(root,"fps")).enabled,true);
 assert.equal(await fs.readFile(library,"utf8"),"untouched");
 const copies=(await fs.readdir(root)).filter(n=>n.startsWith("krysta-fps.json.corrupt-"));
 assert.equal(copies.length,1);
 assert.equal(await fs.readFile(path.join(root,copies[0]),"utf8"),"{broken");
});

test("invalid typed settings without backup use safe defaults",async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"krysta-repair-"));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.writeFile(path.join(root,"krysta-game-update-settings.json"),JSON.stringify({enabled:"yes",intervalHours:0,autoDownloadEpic:true}));
 const results=await repairKrystaSettings(root);
 assert.equal(results.find(x=>x.name==="game-updates")?.state,"defaults");
 const p=await readKrystaSettings<{enabled:boolean;intervalHours:number;autoDownloadEpic:boolean}>(root,"game-updates");
 assert.equal(p.enabled,false);assert.equal(p.intervalHours,6);assert.equal(p.autoDownloadEpic,false);
});

test("first launch leaves absent settings untouched and respects initial defaults",async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"krysta-repair-"));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 assert.equal((await readKrystaSettings<{automatic:boolean}>(root,"updates",{automatic:true})).automatic,true);
 assert.equal((await repairKrystaSettings(root)).every(x=>x.state==="missing"),true);
 assert.deepEqual(await fs.readdir(root),[]);
});

test("valid settings seed backup and invalid writes are rejected",async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"krysta-repair-"));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const file=path.join(root,"krysta-cloud.json");
 await fs.writeFile(file,JSON.stringify({provider:"google",autoBackup:true}));
 await repairKrystaSettings(root);
 await assert.rejects(writeKrystaSettings(root,"cloud",{provider:"invalid"}));
 assert.equal(JSON.parse(await fs.readFile(file,"utf8")).provider,"google");
 await fs.unlink(file);
 const results=await repairKrystaSettings(root);
 assert.equal(results.find(x=>x.name==="cloud")?.state,"restored");
 assert.equal((await readKrystaSettings<{provider:string}>(root,"cloud")).provider,"google");
});
