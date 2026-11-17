import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

async function fixture(t: TestContext, games: Array<{shop: string; objectId: string; title: string}>) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "krysta-screenshot-recovery-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, "Filmy z GIEREK");
  await fs.mkdir(root, { recursive: true });
  const key = "__screenshotRecovery" + randomUUID().replaceAll("-", "");
  const state = {
    games,
    root,
    imported: [] as Array<{path: string; shop: string; objectId: string; gameTitle: string; state: string}>,
    warnings: [] as unknown[],
  };
  (globalThis as Record<string, unknown>)[key] = state;
  t.after(() => { delete (globalThis as Record<string, unknown>)[key]; });

  const outfile = path.join(temp, "fixture.mjs");
  const stub = `const state=globalThis[${JSON.stringify(key)}];
export const gamesSublevel={values:()=>({all:async()=>state.games})};
export const getScreenshotFolderCandidates=async()=>[state.root];
export const getDefaultScreenshotsFolder=()=>state.root;
export const resolveManualScreenshotPath=(_root,title)=>"screenshots/"+title+"/sample.jpeg";
export const LocalScreenshotStore={
  listIncludingDeleted:async()=>state.imported,
  put:async(photo)=>{state.imported.push(photo);}
};
export const logger={info:()=>{},warn:(...args)=>state.warnings.push(args)};`;
  await build({
    stdin: {
      contents: "export {recoverGameScreenshotsFromDisk} from './src/main/services/screenshots/local-screenshot-disk-recovery.ts';",
      resolveDir: process.cwd(),
      sourcefile: "fixture.ts",
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    plugins: [{
      name: "isolated-screenshot-recovery",
      setup(plugin) {
        plugin.onResolve({
          filter: /^(@main\/level|\.\/screenshots-folder|\.\/screenshot-file-path|\.\/local-screenshot-store|\.\.\/logger)$/,
        }, () => ({path:"stub",namespace:"fixture"}));
        plugin.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:stub,loader:"js"}));
      },
    }],
  });
  const module = await import(pathToFileURL(outfile).href);
  return { ...state, recover: module.recoverGameScreenshotsFromDisk as () => Promise<void> };
}

test("recovers already existing screenshots from custom folder and keeps originals", async (t) => {
  const f = await fixture(t, [{shop:"custom",objectId:"game-1",title:"Pionero Capital"}]);
  const folder = path.join(f.root, "Pionero Capital-55d3f410a68d");
  await fs.mkdir(folder);
  const photo = path.join(folder, "2026-10-15_12-30-00.jpeg");
  await fs.writeFile(photo, "not-a-real-jpeg-fixture");
  await f.recover();
  assert.equal(f.imported.length, 1);
  assert.equal(f.imported[0].path, photo);
  assert.equal(f.imported[0].objectId, "game-1");
  assert.equal(f.imported[0].gameTitle, "Pionero Capital");
  assert.equal(f.imported[0].state, "local");
  assert.equal(await fs.readFile(photo, "utf8"), "not-a-real-jpeg-fixture");
  await f.recover();
  assert.equal(f.imported.length, 1);
});

test("does not index folders when title is ambiguous, unknown or unsafe", async (t) => {
  const f = await fixture(t, [
    {shop:"steam",objectId:"1",title:"Duplicate"},
    {shop:"epic",objectId:"2",title:"Duplicate"},
    {shop:"steam",objectId:"3",title:"Known"},
  ]);
  for (const folder of ["Duplicate-12345678","Unknown-12345678","Known-other"]) {
    const dir = path.join(f.root, folder);
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir,"photo.png"),"image-fixture");
  }
  const known = path.join(f.root,"Known");
  await fs.mkdir(known);
  await fs.writeFile(path.join(known,"malware.exe"),"not-a-photo");
  await f.recover();
  assert.equal(f.imported.length, 0);
});
