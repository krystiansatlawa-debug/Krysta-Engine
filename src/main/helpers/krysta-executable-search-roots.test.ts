import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import {
  krystaCandidateInstallRoots,
  krystaCandidateWindowsDrives,
  krystaExecutableSteamId,
  krystaGameDirectoryNames,
} from "./krysta-executable-search-roots.js";

test("custom game uses Steam catalogue identity, not its local library id", () => {
  assert.equal(krystaExecutableSteamId({
    shop: "custom",
    objectId: "local-123",
    catalogueGame: { shop: "steam", objectId: "292030" },
  }), "292030");
  assert.equal(krystaExecutableSteamId({shop:"steam",objectId:"620"}), "620");
  assert.equal(krystaExecutableSteamId({shop:"custom",objectId:"local-123"}), null);
  assert.equal(krystaExecutableSteamId({shop:"steam",objectId:"../620"}), null);
});

test("searches exact game-name folders on E: and F: without scanning drive roots", () => {
  const folders = krystaCandidateInstallRoots("Assassin's Creed IV: Black Flag",["E:","F:"]);
  assert.ok(folders.includes("E:\\Games\\Assassin's Creed IV Black Flag"));
  assert.ok(folders.includes("F:\\GOG Games\\Assassins Creed IV Black Flag"));
  assert.ok(folders.every((location) => /^[EF]:\\/.test(location)));
  assert.ok(!folders.includes("E:\\"));
  assert.ok(krystaCandidateWindowsDrives().includes("E:"));
  assert.ok(krystaGameDirectoryNames("Cyberpunk 2077").includes("Cyberpunk 2077"));
});

async function fixture(t: TestContext) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),"krysta-exe-discovery-"));
  t.after(() => fs.rm(temp,{recursive:true,force:true}));
  const key = "__krystaExecutableDiscovery" + randomUUID().replaceAll("-","");
  const state = {
    game: {shop:"custom",objectId:"custom-1",title:"The Witcher 3: Wild Hunt",catalogueGame:{shop:"steam",objectId:"292030"},executablePath:null,isDeleted:false},
    known: new Map<string, Array<{exe:string;name:string}>>([
      ["292030", [{exe:"witcher3.exe",name:"bin/x64/witcher3.exe"}]],
    ]),
    queries: [] as string[],
    handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  };
  (globalThis as Record<string,unknown>)[key] = state;
  t.after(() => {delete (globalThis as Record<string,unknown>)[key];});
  const output = path.join(temp,"exe-fixture.mjs");
  const stub = `const s=globalThis[${JSON.stringify(key)}];
export const ipcMain={handle:(name,fn)=>s.handlers.set(name,fn)};
export const downloadsSublevel={get:async()=>null};
export const gamesSublevel={get:async()=>s.game};
export const levelKeys={game:(shop,id)=>shop+":"+id};
export const getDownloadFolderPath=async()=>null;
export const GameExecutables={
  ensureLoaded:async()=>true,
  getExecutablesForGame:(id)=>{s.queries.push(id);return s.known.get(id)??null}
};
export const libraryWriteQueue={run:async task=>task()};
export const updateGameExecutablePath=(game,exe)=>({...game,executablePath:exe});
export const canAutoLinkKrystaExecutable=game=>!!game&&!game.executablePath&&!game.isDeleted;
export const getSteamLibraryFolders=async()=>[];
export const findInstalledSteamApp=async()=>null;
export const scanUbisoft=async()=>({games:[]});
`;
  const real = /^@main\/helpers\/(?:krysta-executable-ranking|krysta-executable-search-roots|game-executable-ranking)$/;
  await build({
    stdin:{
      contents:"export {discoverKrystaGameExecutable} from './src/main/events/krysta-executable-discovery.ts';",
      resolveDir:process.cwd(),
      sourcefile:"fixture.ts",
      loader:"ts",
    },
    bundle:true,
    platform:"node",
    format:"esm",
    outfile:output,
    plugins:[{
      name:"exe-discovery-fixture",
      setup(plugin){
        plugin.onResolve({filter:real},(args)=>({
          path:path.join(process.cwd(),"src/main/helpers",args.path.split("/").at(-1)+".ts"),
        }));
        plugin.onResolve({filter:/^(electron|@main\/|\.\/krysta-ubisoft$)/},args=>({path:args.path,namespace:"fixture"}));
        plugin.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:stub,loader:"js"}));
      },
    }],
  });
  const module=await import(pathToFileURL(output).href);
  return {
    temp,
    state,
    discover: (folder:string) =>
      module.discoverKrystaGameExecutable("custom","custom-1",folder) as Promise<{
        automaticPath:string|null;
        candidates:Array<{path:string;highConfidence:boolean}>;
        searchedFolders:number;
      }>,
  };
}

test("automatically selects a known game EXE in the chosen folder",async(t)=>{
  const f=await fixture(t);
  await fs.mkdir(path.join(f.temp,"bin","x64"),{recursive:true});
  const expected=path.join(f.temp,"bin","x64","witcher3.exe");
  await fs.writeFile(expected,"fixture");
  await fs.writeFile(path.join(f.temp,"setup.exe"),"fixture");
  await fs.writeFile(path.join(f.temp,"unrelated.exe"),"fixture");
  const result=await f.discover(f.temp);
  assert.equal(result.automaticPath,expected);
  assert.equal(result.searchedFolders,1);
  assert.deepEqual(f.state.queries,["292030"]);
});

test("never automatically picks among equally valid or unrelated executables",async(t)=>{
  const f=await fixture(t);
  f.state.game.title="Cyberpunk 2077";
  f.state.game.catalogueGame={shop:"steam",objectId:"1091500"};
  await fs.mkdir(path.join(f.temp,"bin"));
  await fs.mkdir(path.join(f.temp,"other"));
  await fs.writeFile(path.join(f.temp,"bin","Cyberpunk2077.exe"),"fixture");
  await fs.writeFile(path.join(f.temp,"other","Cyberpunk2077.exe"),"fixture");
  const ambiguous=await f.discover(f.temp);
  assert.equal(ambiguous.automaticPath,null);
  await fs.rm(path.join(f.temp,"bin","Cyberpunk2077.exe"));
  await fs.rm(path.join(f.temp,"other","Cyberpunk2077.exe"));
  await fs.writeFile(path.join(f.temp,"updater.exe"),"fixture");
  await fs.writeFile(path.join(f.temp,"random.exe"),"fixture");
  const unrelated=await f.discover(f.temp);
  assert.equal(unrelated.automaticPath,null);
});
