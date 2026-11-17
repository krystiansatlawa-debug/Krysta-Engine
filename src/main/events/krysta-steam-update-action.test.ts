import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { build } from "esbuild";

async function fixture(t: TestContext) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "krysta-steam-update-"));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const key = "__steamUpdateFixture" + randomUUID().replaceAll("-", "");
  const state = {
    root: tmp,
    game: { shop: "steam", objectId: "620", title: "Game", executablePath: "/steam/game.exe" as string | null, epicInstallation: null as null | {artifactId:string;platform:string} },
    epicOptions: [] as Array<{artifactId:string;platform:string;installed:boolean;installedVersion:string;publishedVersion:string}>,
    epicError: true,
    updateRequired: true,
    installed: true,
    sameInstall: true,
    running: false,
    backupSucceeds: true,
    backupEnabled: true,
    dialogResponse: 0,
    backupCalls: 0,
    links: [] as string[],
    handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  };
  (globalThis as Record<string, unknown>)[key] = state;
  t.after(() => { delete (globalThis as Record<string, unknown>)[key]; });
  const stub = `const s=globalThis[${JSON.stringify(key)}];
export const app={getPath:()=>s.root,whenReady:()=>new Promise(()=>{}),on:()=>{}};
export const ipcMain={handle:(name,fn)=>s.handlers.set(name,fn)};
export const shell={openExternal:async uri=>s.links.push(uri)};
export const dialog={showMessageBox:async()=>({response:s.dialogResponse})};
export const net={fetch:async()=>({ok:false})};
export const readKrystaSettings=async()=>({pauseDuringPlay:true,backupBeforeUpdate:s.backupEnabled,notifications:false});
export const writeKrystaSettings=async()=>{};
export const gamesSublevel={get:async()=>s.game};
export const levelKeys={game:(shop,id)=>shop+":"+id};
export const getEpicGameInstallOptions=async()=>({options:s.epicOptions,error:s.epicError});
export const startEpicGameUpdate=async()=>({ok:false});
export const scanUbisoft=async()=>({games:[]});
export const findUbisoftExecutable=()=>null;
export const publishKrystaNotification=async()=>{};
export const backupBeforeGameUpdate=async()=>{s.backupCalls++;if(!s.backupSucceeds)throw Error("Backup failed");return true;};
export const getGameNews=async()=>({appId:"",items:[]});
export const getSteamLibraryFolders=async()=>["/steam"];
export const readSteamUpdateState=async()=>({updateRequired:s.updateRequired,buildId:"123"});
export const findInstalledSteamApp=async()=>s.installed?{appId:"620",installDirectory:"/steam"}:null;
export const isPathInsideSteamInstallDirectory=()=>s.sameInstall;
export const hasTrackedGamesRunning=()=>s.running;
export const mergePublishedPatches=()=>[];
export const announcedGamePatchVersion=()=>null;
`;
  const outfile = path.join(tmp, "fixture.mjs");
  await build({
    stdin:{
      contents:"import './src/main/events/krysta-game-update-watch.ts';",
      resolveDir:process.cwd(),
      sourcefile:"fixture.ts",
      loader:"ts",
    },
    bundle:true,
    platform:"node",
    format:"esm",
    outfile,
    plugins:[{
      name:"mock-official-launchers",
      setup(plugin){
        plugin.onResolve({
          filter:/^(electron|@main\/|\.\/krysta-ubisoft$|\.\/krysta-cloud$|\.\/krysta-game-news$|\.\.\/\.\.\/shared\/game-update-patch-history$)/,
        },args=>({path:args.path,namespace:"stub"}));
        plugin.onLoad({filter:/.*/,namespace:"stub"},()=>({contents:stub,loader:"js"}));
      },
    }],
  });
  await import(pathToFileURL(outfile).href);
  const open = state.handlers.get("krysta:game-watch-open-client");
  assert.ok(open, "Steam update handler must be registered");
  const trigger = () => open(null, "steam", "620");
  return { state, trigger };
}

test("Steam update button validates the specific installed game and respects backup failures", async(t)=>{
  const {state,trigger}=await fixture(t);
  await t.test("requested update validates the correct game after backup",async()=>{
    await trigger();
    assert.deepEqual(state.links, ["steam://validate/620"]);
    assert.equal(state.backupCalls,1);
  });
  await t.test("up-to-date game opens details without forced validation",async()=>{
    state.links.length=0;
    state.updateRequired=false;
    await trigger();
    assert.deepEqual(state.links, ["steam://nav/games/details/620"]);
    assert.equal(state.backupCalls,1);
    state.updateRequired=true;
  });
  await t.test("missing installation never requests a modifying Steam action",async()=>{
    state.links.length=0;
    state.installed=false;
    await assert.rejects(trigger(), /Steam installation/);
    assert.deepEqual(state.links, []);
    state.installed=true;
  });
  await t.test("executable pointing outside installation is rejected",async()=>{
    state.links.length=0;
    state.sameInstall=false;
    await assert.rejects(trigger(), /Steam installation/);
    assert.deepEqual(state.links, []);
    state.sameInstall=true;
  });
  await t.test("failed save backup blocks update verification",async()=>{
    state.links.length=0;
    state.backupSucceeds=false;
    await assert.rejects(trigger(), /Backup failed/);
    assert.deepEqual(state.links,[]);
    state.backupSucceeds=true;
  });
  await t.test("running game blocks update verification",async()=>{
    state.links.length=0;
    state.running=true;
    await assert.rejects(trigger(), /Zamknij uruchomione gry/);
    assert.deepEqual(state.links,[]);
  });
});

test("Epic reports installed and published versions without a manually configured EXE",async(t)=>{
 const {state}=await fixture(t);
 state.game.shop="epic";
 state.game.objectId="epic-game";
 state.game.executablePath=null;
 state.game.epicInstallation={artifactId:"artifact-01",platform:"Windows"};
 state.epicError=false;
 state.epicOptions=[{
   artifactId:"artifact-01",
   platform:"Windows",
   installed:true,
   installedVersion:"1.0.0",
   publishedVersion:"1.0.2",
 }];
 const check=state.handlers.get("krysta:game-watch-check");
 assert.ok(check);
 const result=await check(null,"epic","epic-game") as {
   installedBuild?:string;
   updateState?:string;
   updateProvider?:string;
 };
 assert.equal(result.installedBuild,"1.0.0");
 assert.equal(result.updateState,"required");
 assert.equal(result.updateProvider,"epic");
 assert.deepEqual(state.links,[]);
});
