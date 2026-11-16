import { gamesSublevel, gamesShopAssetsSublevel, levelKeys } from "@main/level";
import { ipcMain, shell } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { win32 } from "node:path";

const exec = promisify(execFile);
async function scan() {
  if (process.platform !== "win32") return { supported: false, installed: false, games: [] };
  const query = async (key: string, args: string[] = []) => {
    try { return (await exec("reg.exe", ["query", key, ...args], { windowsHide: true, timeout: 10000 })).stdout; }
    catch { return ""; }
  };
  const base = "HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher";
  const roots = await Promise.all([base, "HKLM\\SOFTWARE\\Ubisoft\\Launcher"].map(async root => ({root, raw: await query(root + "\\Installs")})));
  const games = new Map<string, {id:string; title:string; path:string}>();
  await Promise.all(roots.flatMap(({raw}) => raw.split(/\r?\n/).filter(line => /\\Installs\\\d+\s*$/.test(line)).map(async line => {
    const key = line.trim();
    const id = key.split("\\").pop()!;
    const rawPath = await query(key, ["/v", "InstallDir"]);
    const path = rawPath.match(/InstallDir\s+REG_\w+\s+(.+)/i)?.[1]?.trim();
    if (!path || !existsSync(path)) return;
    const name = await query("HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Uplay Install " + id, ["/v","DisplayName"]);
    const title = name.match(/DisplayName\s+REG_\w+\s+(.+)/i)?.[1]?.trim() || win32.basename(path);
    games.set(id, {id,title,path});
  })));
  const installed = Boolean((await query("HKCR\\uplay\\shell\\open\\command")).trim());
  return { supported:true, installed, games: [...games.values()].sort((a,b)=>a.title.localeCompare(b.title)) };
}
ipcMain.handle("krysta:ubisoft-scan", scan);
export async function launchUbisoft(id: unknown) {
  if (process.platform !== "win32" || typeof id !== "string" || !/^\d{1,12}$/.test(id)) throw new Error("Invalid Ubisoft game");
  const result = await scan();
  if (!result.installed || !result.games.some(game=>game.id===id)) throw new Error("Ubisoft game not installed");
  await shell.openExternal("uplay://launch/" + id + "/0");
}
ipcMain.handle("krysta:ubisoft-launch", (_event, id: unknown) => launchUbisoft(id));

ipcMain.handle("krysta:ubisoft-import", async () => {
  const result = await scan();
  let imported = 0;
  for (const item of result.games) {
    const objectId = "ubisoft-" + item.id;
    const shop = "custom" as const;
    const key = levelKeys.game(shop, objectId);
    const existing = (await gamesSublevel.iterator().all()).find(([k]) => k === key)?.[1];
    if (existing && !existing.isDeleted) continue;
    await gamesShopAssetsSublevel.put(key, {
      updatedAt: Date.now(), objectId, shop, title: item.title,
      iconUrl: null, libraryHeroImageUrl: "", libraryImageUrl: "",
      logoImageUrl: "", logoPosition: null, coverImageUrl: "", downloadSources: [],
    });
    await gamesSublevel.put(key, {
      title: item.title, iconUrl: null, logoImageUrl: null, libraryHeroImageUrl: null,
      objectId, shop, remoteId: null, isDeleted: false, playTimeInMilliseconds: 0,
      lastTimePlayed: null, addedToLibraryAt: new Date(),
      executablePath: item.path, executablePathUpdatedAt: new Date(),
      launchOptions: null, favorite: false, automaticCloudSync: false,
      hasManuallyUpdatedPlaytime: false,
    });
    imported++;
  }
  return imported;
});
