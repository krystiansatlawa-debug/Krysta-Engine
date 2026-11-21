import { ipcMain, shell } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { gamesSublevel, gamesShopAssetsSublevel, levelKeys } from "@main/level";
import { libraryWriteQueue } from "@main/services/library-sync/library-write-queue";
import { getGameAssets } from "./catalogue/get-game-assets";
import type { Game } from "@types";

const exec = promisify(execFile);
const titles = [
  {
    id: "gtav-legacy",
    title: "Grand Theft Auto V",
    aliases: ["Grand Theft Auto V Legacy", "GTA V", "GTA V Legacy"],
    keys: ["Grand Theft Auto V"],
    exe: ["PlayGTAV.exe", "GTA5.exe"],
    steam: "271590",
  },
  {
    id: "gtav-enhanced",
    title: "Grand Theft Auto V Enhanced",
    aliases: ["GTA V Enhanced"],
    keys: ["Grand Theft Auto V Enhanced"],
    exe: ["PlayGTAV.exe", "GTA5_Enhanced.exe"],
    steam: "3240220",
  },
  {
    id: "rdr2",
    title: "Red Dead Redemption 2",
    aliases: ["RDR2"],
    keys: ["Red Dead Redemption 2"],
    exe: ["PlayRDR2.exe", "RDR2.exe"],
    steam: "1174180",
  },
  {
    id: "rdr",
    title: "Red Dead Redemption",
    aliases: [],
    keys: ["Red Dead Redemption"],
    exe: ["RDR.exe"],
    steam: "2668510",
  },
  {
    id: "gtaiv",
    title: "Grand Theft Auto IV: The Complete Edition",
    aliases: ["Grand Theft Auto IV", "GTA IV"],
    keys: ["Grand Theft Auto IV", "Grand Theft Auto IV Complete Edition"],
    exe: ["PlayGTAIV.exe", "GTAIV.exe"],
    steam: "12210",
  },
  {
    id: "maxpayne3",
    title: "Max Payne 3",
    aliases: [],
    keys: ["Max Payne 3"],
    exe: ["PlayMaxPayne3.exe", "MaxPayne3.exe"],
    steam: "204100",
  },
  {
    id: "lanoire",
    title: "L.A. Noire",
    aliases: ["LA Noire"],
    keys: ["L.A. Noire", "LA Noire"],
    exe: ["LANoire.exe"],
    steam: "110800",
  },
  {
    id: "bully",
    title: "Bully: Scholarship Edition",
    aliases: ["Bully Scholarship Edition"],
    keys: ["Bully Scholarship Edition", "Bully"],
    exe: ["Bully.exe"],
    steam: "12200",
  },
  {
    id: "gta3",
    title: "Grand Theft Auto III",
    aliases: ["Grand Theft Auto 3"],
    keys: ["Grand Theft Auto III", "Grand Theft Auto 3"],
    exe: ["gta3.exe"],
    steam: "12100",
  },
  {
    id: "gtavc",
    title: "Grand Theft Auto: Vice City",
    aliases: [],
    keys: ["Grand Theft Auto Vice City", "Grand Theft Auto: Vice City"],
    exe: ["gta-vc.exe"],
    steam: "12110",
  },
  {
    id: "gtasa",
    title: "Grand Theft Auto: San Andreas",
    aliases: [],
    keys: ["Grand Theft Auto San Andreas", "Grand Theft Auto: San Andreas"],
    exe: ["gta_sa.exe"],
    steam: "12120",
  },
  {
    id: "gta3-de",
    title: "Grand Theft Auto III – The Definitive Edition",
    aliases: ["Grand Theft Auto III The Definitive Edition"],
    keys: [
      "Grand Theft Auto III - The Definitive Edition",
      "Grand Theft Auto III Definitive Edition",
    ],
    exe: ["Gameface\\Binaries\\Win64\\LibertyCity.exe"],
    steam: "1546970",
  },
  {
    id: "gtavc-de",
    title: "Grand Theft Auto: Vice City – The Definitive Edition",
    aliases: [],
    keys: [
      "Grand Theft Auto Vice City - The Definitive Edition",
      "Grand Theft Auto Vice City Definitive Edition",
    ],
    exe: ["Gameface\\Binaries\\Win64\\ViceCity.exe"],
    steam: "1546990",
  },
  {
    id: "gtasa-de",
    title: "Grand Theft Auto: San Andreas – The Definitive Edition",
    aliases: [],
    keys: [
      "Grand Theft Auto San Andreas - The Definitive Edition",
      "Grand Theft Auto San Andreas Definitive Edition",
    ],
    exe: ["Gameface\\Binaries\\Win64\\SanAndreas.exe"],
    steam: "1547000",
  },
] as const;
type Detected = {
  id: string;
  title: string;
  folder: string;
  executablePath: string;
  steamId: string;
  aliases: readonly string[];
};
const normalize = (s: string) =>
  s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const samePath = (a: string, b: string) =>
  path.win32.normalize(a).toLowerCase() ===
  path.win32.normalize(b).toLowerCase();
const inside = (file: string, folder: string) => {
  const relative = path.win32.relative(folder, file);
  return (
    relative !== "" &&
    !relative.startsWith("..\\") &&
    relative !== ".." &&
    !path.win32.isAbsolute(relative)
  );
};
async function existingFile(file: string) {
  try {
    const s = await fs.stat(file);
    return s.isFile() ? await fs.realpath(file) : null;
  } catch {
    return null;
  }
}
async function query(root: string) {
  try {
    const { stdout } = await exec("reg.exe", ["query", root, "/s"], {
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  } catch {
    return "";
  }
}
function parseRegistry(raw: string) {
  const rows = new Map<string, Map<string, string>>();
  let current: Map<string, string> | undefined;
  for (const line of raw.split(/\r?\n/)) {
    if (/^HKEY_/i.test(line.trim())) {
      current = new Map();
      rows.set(line.trim().split("\\").pop()!.toLowerCase(), current);
      continue;
    }
    const match = line.match(
      /^\s+([^\s]+)\s+REG_(?:SZ|EXPAND_SZ)\s+(.+?)\s*$/i
    );
    if (match && current) current.set(match[1].toLowerCase(), match[2]);
  }
  return rows;
}
function localFolder(v: unknown) {
  if (typeof v !== "string") return null;
  // Registry paths may use %ProgramFiles% and surrounding quotes.
  const expanded = v.trim().replace(/^"|"$/g, "").replace(/%([^%]+)%/g, (match, name: string) =>
    Object.entries(process.env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] ?? match
  );
  if (!/^[a-z]:[\\/]/i.test(expanded)) return null;
  const normalized = path.win32.normalize(expanded);
  return path.win32.parse(normalized).root.toLowerCase() === normalized.toLowerCase()
    ? null : normalized;
}
export async function scanRockstar() {
  if (process.platform !== "win32")
    return {
      supported: false,
      installed: false,
      launcher: null as string | null,
      games: [] as Detected[],
    };
  const registry = await Promise.all(
    [
      "HKLM\\SOFTWARE\\WOW6432Node\\Rockstar Games",
      "HKLM\\SOFTWARE\\Rockstar Games",
      "HKCU\\SOFTWARE\\WOW6432Node\\Rockstar Games",
      "HKCU\\SOFTWARE\\Rockstar Games",
    ].map(async (key) => parseRegistry(await query(key)))
  );
  let launcher: string | null = null;
  const launcherFolders = [
    ...registry.flatMap((r) => {
      const fields = r.get("launcher");
      return [fields?.get("installfolder"), fields?.get("installlocation"), fields?.get("installdir")];
    }),
    ...[process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.ProgramW6432]
      .filter((root): root is string => !!root)
      .map((root) => path.join(root, "Rockstar Games", "Launcher")),
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Rockstar Games", "Launcher")
      : null,
  ];
  for (const folder of launcherFolders) {
    const candidate = localFolder(folder);
    if (!candidate) continue;
    launcher = await existingFile(path.join(candidate, "Launcher.exe"));
    if (launcher) break;
  }
  const games: Detected[] = [];
  for (const t of titles) {
    const matches = new Map<string, Detected>();
    for (const row of registry)
      for (const name of [...t.keys, ...t.aliases]) {
        const data = row.get(name.toLowerCase());
        const p = localFolder(data?.get("installfolder"));
        if (!p) continue;
        // Do not treat explicitly platform-specific installations as Rockstar-native.
        if (
          [
            data?.get("installfolderepic"),
            data?.get("installfoldersteam"),
          ].some((f) => f && samePath(f, p))
        )
          continue;
        const folder = await fs.realpath(p).catch(() => null);
        if (!folder) continue;
        if (/\\steamapps\\common\\|\\epic games\\/i.test(folder)) continue;
        if (launcher && inside(launcher, folder)) continue;
        for (const name of t.exe) {
          const executablePath = await existingFile(path.join(folder, name));
          if (!executablePath || !inside(executablePath, folder)) continue;
          // Require the Enhanced binary when distinguishing the two GTA V editions.
          if (
            t.id === "gtav-enhanced" &&
            !(await existingFile(path.join(folder, "GTA5_Enhanced.exe")))
          )
            continue;
          if (
            t.id === "gtav-legacy" &&
            (await existingFile(path.join(folder, "GTA5_Enhanced.exe")))
          )
            continue;
          matches.set(folder.toLowerCase(), {
            id: t.id,
            title: t.title,
            folder,
            executablePath,
            steamId: t.steam,
            aliases: t.aliases,
          });
          break;
        }
      }
    if (matches.size === 1) games.push([...matches.values()][0]);
  }
  return { supported: true, installed: !!launcher, launcher, games };
}
let importing = false;
let lastSync: string | null = null;
ipcMain.handle("krysta:rockstar-scan", async () => ({
  ...(await scanRockstar()),
  lastSync,
}));
ipcMain.handle("krysta:rockstar-open", async () => {
  const result = await scanRockstar();
  if (!result.launcher) throw Error("Rockstar Games Launcher not detected");
  const error = await shell.openPath(result.launcher);
  if (error) throw Error("Cannot open Rockstar Games Launcher");
});
ipcMain.handle("krysta:rockstar-import", async () => {
  if (importing) throw Error("Rockstar import already running");
  importing = true;
  try {
    const scan = await scanRockstar();
    if (!scan.supported || !scan.installed)
      throw Error("Rockstar Games Launcher not detected");
    let added = 0,
      linked = 0,
      existing = 0,
      skipped = 0;
    // Fetch metadata before acquiring the library write queue.
    for (const item of scan.games) {
      const assets = await getGameAssets(item.steamId, "steam").catch(
        () => null
      );
      const names = new Set([item.title, ...item.aliases].map(normalize));
      const validatedAssets =
        assets && names.has(normalize(assets.title)) ? assets : null;
      const result = await libraryWriteQueue.run(async () => {
        const rows = (await gamesSublevel.iterator().all()).filter(
          ([, g]) => !g.isDeleted
        );
        const exact = rows.filter(
          ([, g]) => g.executablePath && inside(g.executablePath, item.folder)
        );
        const catalogueKey = levelKeys.game("steam", item.steamId);
        const matches = rows.filter(
          ([k, g]) => k === catalogueKey || names.has(normalize(g.title))
        );
        if (exact.length === 1) return "existing";
        if (exact.length > 1 || matches.length > 1) return "skipped";
        if (matches.length === 1) {
          const [key, g] = matches[0];
          // Preserve existing official platform ownership and user-selected paths.
          if (
            g.hasActiveSteamImport ||
            g.hasActiveEpicImport ||
            g.epicInstallation ||
            g.source === "steam" ||
            g.source === "epic" ||
            g.executablePath
          )
            return "skipped";
          await gamesSublevel.put(key, {
            ...g,
            executablePath: item.executablePath,
            executablePathUpdatedAt: new Date(),
          });
          return "linked";
        }
        // Prefer the existing Hydra catalogue identity whenever metadata confirms it.
        const shop = validatedAssets ? ("steam" as const) : ("custom" as const);
        const objectId = validatedAssets ? item.steamId : "rockstar-" + item.id;
        const key = levelKeys.game(shop, objectId),
          old = await gamesSublevel.get(key);
        if (old && !old.isDeleted) return "skipped";
        const game: Game = {
          ...old,
          title: validatedAssets?.title ?? item.title,
          iconUrl: validatedAssets?.iconUrl ?? null,
          libraryHeroImageUrl: validatedAssets?.libraryHeroImageUrl ?? null,
          logoImageUrl: validatedAssets?.logoImageUrl ?? null,
          objectId,
          shop,
          remoteId: old?.remoteId ?? null,
          isDeleted: false,
          playTimeInMilliseconds: old?.playTimeInMilliseconds ?? 0,
          lastTimePlayed: old?.lastTimePlayed ?? null,
          addedToLibraryAt: old?.addedToLibraryAt ?? new Date(),
          executablePath: item.executablePath,
          executablePathUpdatedAt: new Date(),
          launchOptions: old?.launchOptions ?? null,
          favorite: old?.favorite ?? false,
          automaticCloudSync: old?.automaticCloudSync ?? false,
          hasManuallyUpdatedPlaytime: old?.hasManuallyUpdatedPlaytime ?? false,
        };
        if (!validatedAssets)
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
        await gamesSublevel.put(key, game);
        return "added";
      });
      if (result === "added") added++;
      else if (result === "linked") linked++;
      else if (result === "existing") existing++;
      else skipped++;
    }
    lastSync = new Date().toISOString();
    return {
      added,
      linked,
      existing,
      skipped,
      lastSync,
      detected: scan.games.length,
    };
  } finally {
    importing = false;
  }
});
