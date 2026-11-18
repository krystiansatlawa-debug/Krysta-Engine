import { gamesSublevel, gamesShopAssetsSublevel, levelKeys } from "@main/level";
import { ipcMain, shell } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readdirSync } from "node:fs";
import { win32 } from "node:path";

const exec = promisify(execFile);
export async function scanUbisoft() {
  if (process.platform !== "win32")
    return { supported: false, installed: false, games: [] };
  const query = async (key: string, args: string[] = []) => {
    try {
      return (
        await exec("reg.exe", ["query", key, ...args], {
          windowsHide: true,
          timeout: 10000,
        })
      ).stdout;
    } catch {
      return "";
    }
  };
  const base = "HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher";
  const roots = await Promise.all(
    [base, "HKLM\\SOFTWARE\\Ubisoft\\Launcher"].map(async (root) => ({
      root,
      raw: await query(root + "\\Installs"),
    }))
  );
  const games = new Map<string, { id: string; title: string; path: string }>();
  await Promise.all(
    roots.flatMap(({ raw }) =>
      raw
        .split(/\r?\n/)
        .filter((line) => /\\Installs\\\d+\s*$/.test(line))
        .map(async (line) => {
          const key = line.trim();
          const id = key.split("\\").pop()!;
          const rawPath = await query(key, ["/v", "InstallDir"]);
          const path = rawPath
            .match(/InstallDir\s+REG_\w+\s+(.+)/i)?.[1]
            ?.trim();
          if (!path || !existsSync(path)) return;
          const name = await query(
            "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Uplay Install " +
              id,
            ["/v", "DisplayName"]
          );
          const title =
            name.match(/DisplayName\s+REG_\w+\s+(.+)/i)?.[1]?.trim() ||
            win32.basename(path);
          games.set(id, { id, title, path });
        })
    )
  );
  const installed = Boolean(
    (await query("HKCR\\uplay\\shell\\open\\command")).trim()
  );
  return {
    supported: true,
    installed,
    games: [...games.values()].sort((a, b) => a.title.localeCompare(b.title)),
  };
}
ipcMain.handle("krysta:ubisoft-scan", scanUbisoft);
export async function launchUbisoft(id: unknown) {
  if (
    process.platform !== "win32" ||
    typeof id !== "string" ||
    !/^\d{1,12}$/.test(id)
  )
    throw new Error("Invalid Ubisoft game");
  const result = await scanUbisoft();
  if (!result.installed || !result.games.some((game) => game.id === id))
    throw new Error("Ubisoft game not installed");
  await shell.openExternal("uplay://launch/" + id + "/0");
}
ipcMain.handle("krysta:ubisoft-launch", (_event, id: unknown) =>
  launchUbisoft(id)
);

ipcMain.handle("krysta:ubisoft-import", async () => {
  const result = await scanUbisoft();
  let imported = 0;
  for (const item of result.games) {
    const objectId = "ubisoft-" + item.id;
    const shop = "custom" as const;
    const key = levelKeys.game(shop, objectId);
    const existing = await gamesSublevel.get(key);
    if (existing && !existing.isDeleted) continue;
    await gamesShopAssetsSublevel.put(key, {
      updatedAt: Date.now(),
      objectId,
      shop,
      title: item.title,
      iconUrl: null,
      libraryHeroImageUrl: "",
      libraryImageUrl: "",
      logoImageUrl: "",
      logoPosition: null,
      coverImageUrl: "",
      downloadSources: [],
    });
    await gamesSublevel.put(key, {
      title: item.title,
      iconUrl: null,
      logoImageUrl: null,
      libraryHeroImageUrl: null,
      objectId,
      shop,
      remoteId: null,
      isDeleted: false,
      playTimeInMilliseconds: 0,
      lastTimePlayed: null,
      addedToLibraryAt: new Date(),
      executablePath: findUbisoftExecutable(item.path, item.title),
      executablePathUpdatedAt: new Date(),
      launchOptions: null,
      favorite: false,
      automaticCloudSync: false,
      hasManuallyUpdatedPlaytime: false,
    });
    imported++;
  }
  return imported;
});

export function findUbisoftExecutable(
  folder: string,
  title: string
): string | null {
  try {
    const normal = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const files = [
      folder,
      ...["bin", "bin64", "Binaries\\Win64"].map((s) => win32.join(folder, s)),
    ].flatMap((dir) => {
      try {
        return readdirSync(dir, { withFileTypes: true })
          .filter(
            (e) =>
              e.isFile() &&
              /\.exe$/i.test(e.name) &&
              !/unins|setup|install|crash|report|redist|benchmark|launcher|updater|anticheat/i.test(
                e.name
              )
          )
          .map((e) => win32.join(dir, e.name));
      } catch {
        return [];
      }
    });
    const exact = files.filter(
      (f) => normal(win32.basename(f, ".exe")) === normal(title)
    );
    return exact.length === 1 ? exact[0] : files.length === 1 ? files[0] : null;
  } catch {
    return null;
  }
}
export async function ubisoftLocalMatch(title: string) {
  const norm = (s: string) =>
    s
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  const result = await scanUbisoft();
  const matches = result.games.filter((g) => norm(g.title) === norm(title));
  return matches.length === 1 ? matches[0] : null;
}
ipcMain.handle("krysta:ubisoft-install", async (_e, objectId: unknown) => {
  if (
    typeof objectId !== "string" ||
    !/^(?:ubi-owned-[a-f0-9]{32}|ubisoft-\d+)$/.test(objectId)
  )
    throw Error("Invalid Ubisoft game");
  const game = await gamesSublevel.get(levelKeys.game("custom", objectId));
  if (!game || game.isDeleted) throw Error("Game not found");
  const result = await scanUbisoft();
  if (!result.installed) throw Error("Install Ubisoft Connect first");
  // Numeric locally verified ID only; account GraphQL IDs are not necessarily launcher IDs.
  const match = await ubisoftLocalMatch(game.title);
  if (match) {
    await shell.openExternal("uplay://launch/" + match.id + "/0");
    return "launched";
  }
  await shell.openExternal("uplay://");
  return "client";
});
