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
ipcMain.handle("krysta:ubisoft-launch", async (_event, id: unknown) => {
  if (process.platform !== "win32" || typeof id !== "string" || !/^\d{1,12}$/.test(id)) throw new Error("Invalid Ubisoft game");
  const result = await scan();
  if (!result.installed || !result.games.some(game=>game.id===id)) throw new Error("Ubisoft game not installed");
  await shell.openExternal("uplay://launch/" + id + "/0");
});
