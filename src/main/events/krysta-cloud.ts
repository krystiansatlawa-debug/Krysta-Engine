import {
  readKrystaSettings,
  writeKrystaSettings,
} from "@main/services/krysta-settings-recovery";
import { app, dialog, ipcMain, shell, net } from "electron";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { publishKrystaNotification } from "@main/services/notifications/krysta-notifications";
import { Ludusavi } from "@main/services/ludusavi";
import { getCloudSavePathContext } from "@main/services/cloud-save/cloud-save-game-context";
import { NativeAddon } from "@main/services/native-addon";
import { SystemPath } from "@main/services/system-path";
import { getRecompilationSaveRules } from "@main/services/cloud-save/recompilation-cloud-save";
import { waitForGameBoostBackgroundSync, isGameBoostBackgroundSyncPaused } from "@main/services/game-boost-background-sync";
import {
  gamesPlaytime,
  hasTrackedGamesRunning,
  onTrackedGamesRunningChange,
  isTrackedGameKeyRunning,
} from "@main/services/game-running-state";
import {
  directCloudIdentity,
  uploadAchievementBackup,
  uploadGoogleMedia,
  uploadCloudSnapshot,
  listRemoteCloudSnapshots,
  downloadCloudSnapshot,
} from "./krysta-cloud-accounts";
import { AchievementMemoryStore } from "@main/services/achievements/achievement-memory-store";
import type { AutomaticGameStoryProgress, GameStoryProgress, GameShop } from "@types";

import { getLocalScreenshots } from "@main/services/screenshots";
import { recordingState, readRecording } from "@main/services/krysta-recordings";

type Provider = "google" | "synology" | "local" | "hydra";
type Config = {
  provider: Provider;
  folder?: string;
  autoBackup?: boolean;
  syncBeforeLaunch?: boolean;
  backupScreenshots?: boolean;
  backupRecordings?: boolean;
};
type Entry = { id: string; createdAt: string; files: number; kind?: string; deviceId?: string; location?: "local" | "cloud" | "both" };
function historyMetadata(m: {kind?: unknown; deviceId?: unknown}) {
  return {
    kind: typeof m.kind === "string" && ["manual","automatic","pre-update","before-restore"].includes(m.kind) ? m.kind : undefined,
    deviceId: typeof m.deviceId === "string" && /^[a-f0-9-]{36}$/.test(m.deviceId) ? m.deviceId : undefined,
  };
}
async function config(): Promise<Config> {
  return readKrystaSettings<Config>(app.getPath("userData"), "cloud");
}
async function save(c: Config) {
  return writeKrystaSettings(app.getPath("userData"), "cloud", c);
}
let deviceIdPromise: Promise<string> | undefined;
function cloudDeviceId(): Promise<string> {
  deviceIdPromise ??= (async () => {
    const file = path.join(app.getPath("userData"), "krysta-cloud-device-id");
    const id = randomUUID();
    await fs.writeFile(file, id, {flag:"wx", mode:0o600}).catch((e: NodeJS.ErrnoException) => { if (e.code !== "EEXIST") throw e; });
    const value = (await fs.readFile(file, "utf8")).trim();
    if (!/^[a-f0-9-]{36}$/.test(value)) throw Error("Invalid cloud device identity");
    return value;
  })().catch(e => { deviceIdPromise = undefined; throw e; });
  return deviceIdPromise;
}
function digest(s: string) {
  return createHash("sha256").update(s).digest("hex");
}
function within(root: string, p: string) {
  const rel = path.relative(root, p);
  return (
    rel === "" ||
    (!rel.startsWith(".." + path.sep) && rel !== ".." && !path.isAbsolute(rel))
  );
}
async function gameContext(shop: GameShop, id: string, preUpdateLocal = false) {
  if (
    typeof shop !== "string" ||
    typeof id !== "string" ||
    !id ||
    id.length > 200
  )
    throw Error("Invalid game");
  const key = levelKeys.game(shop, id);
  const game = await gamesSublevel.get(key);
  if (!game || game.isDeleted) throw Error("Game not in library");
  if (preUpdateLocal) {
    const folder = path.join(
      app.getPath("userData"),
      "krysta-pre-update-backups"
    );
    await fs.mkdir(folder, { recursive: true, mode: 0o700 });
    const info = await fs.lstat(folder);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw Error("Unsafe local backup folder");
    const root = await fs.realpath(folder),
      remoteKey = digest(shop + ":" + id);
    return {
      key,
      game,
      root,
      base: path.join(root, "Krysta Cloud", remoteKey),
      provider: null,
      identity: null,
      remoteKey,
    };
  }
  const c = await config();
  if (c.provider === "hydra")
    throw Error("Select a private cloud provider in settings");
  const provider =
    c.provider === "google" || c.provider === "synology" ? c.provider : null;
  const identity = provider ? await directCloudIdentity(provider) : null;
  if (!provider && !c.folder)
    throw Error("Select a local backup folder in settings");
  const cache = provider
    ? path.join(
        app.getPath("userData"),
        "krysta-direct-cache",
        provider,
        identity!
      )
    : null;
  if (cache) await fs.mkdir(cache, { recursive: true });
  const root = await fs.realpath(cache ?? c.folder!);
  const remoteKey = digest(shop + ":" + id);
  const base = path.join(root, "Krysta Cloud", remoteKey);
  return { key, game, base, root, provider, identity, remoteKey };
}
async function safeDirectory(root: string, dir: string) {
  await fs.mkdir(dir, { recursive: true });
  const actual = await fs.realpath(dir);
  if (
    !within(root, actual) ||
    path.relative(root, actual) !== path.relative(root, dir)
  )
    throw Error("Unsafe cloud directory");
  return actual;
}
async function discover(shop: GameShop, id: string) {
  const context = await getCloudSavePathContext(id, shop).catch(() => undefined);
  const game = context?.game;
  const data = await Ludusavi.getBackupPreview(shop, id, context?.pathContext.winePrefixPath).catch(() => null);
  const matches = data?.games ?? {};
  const values = Object.values(matches);
  const match = matches[id] ?? (values.length === 1 ? values[0] : undefined);
  const paths = Object.keys(match?.files ?? {});
  if (context && game && !context.emulatorProvider) {
    const native = await (async () => {
      const { rules } = await NativeAddon.getSaveRulesForGame({
        shop, objectId: id, title: game.title, remoteId: game.remoteId ?? undefined,
        userDataPath: SystemPath.getPath("userData"),
        recompilationRules: getRecompilationSaveRules(context.pathContext, game.executablePath)
      });
      return NativeAddon.scanLocalSaveRuleFiles(context.pathContext, rules.filter(({ tags }) => tags.includes("save")));
    })().catch(() => []);
    paths.push(...native);
  }
  if (paths.length > 5000) throw Error("Too many detected save files");
  const files: string[] = [];
  for (const p of [...new Set(paths)]) {
    if (!path.isAbsolute(p)) continue;
    const info = await fs.lstat(p).catch(() => null);
    if (info?.isFile() && !info.isSymbolicLink())
      files.push(await fs.realpath(p));
  }
  return [...new Set(files)];
}
const locks = new Set<string>();
async function locked<T>(key: string, fn: () => Promise<T>) {
  if (locks.has(key)) throw Error("Backup operation already running");
  locks.add(key);
  try {
    return await fn();
  } finally {
    locks.delete(key);
  }
}
async function copyVerified(src: string, dst: string) {
  const st = await fs.lstat(src);
  if (!st.isFile() || st.isSymbolicLink()) throw Error("Invalid save file");
  await fs.copyFile(src, dst, 1);
  const after = await fs.stat(src);
  if (st.size !== after.size || st.mtimeMs !== after.mtimeMs)
    throw Error("Save changed during backup");
}
ipcMain.handle("krysta:cloud-config", config);
ipcMain.handle("krysta:cloud-provider", async (_e, p: unknown) => {
  if (p !== "google" && p !== "synology" && p !== "local" && p !== "hydra")
    throw Error("Invalid provider");
  return save({ provider: p, autoBackup: false });
});
ipcMain.handle("krysta:cloud-folder", async () => {
  const c = await config();
  if (c.provider !== "local") return c;
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return c;
  return save({ ...c, folder: await fs.realpath(result.filePaths[0]) });
});
async function localEntries(base: string, root: string): Promise<Entry[]> {
  await safeDirectory(root, base);
  const list: Entry[] = [];
  for (const name of await fs.readdir(base)) {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(name)) continue;
    try {
      const dir = await fs.realpath(path.join(base, name));
      if (dir !== path.join(base, name)) continue;
      const mp = path.join(dir, "manifest.json"),
        st = await fs.lstat(mp);
      if (!st.isFile() || st.isSymbolicLink() || st.size > 8 * 1024 ** 2)
        continue;
      const m = JSON.parse(await fs.readFile(mp, "utf8"));
      if (
        m.id === name &&
        Array.isArray(m.files) &&
        typeof m.createdAt === "string" && Number.isFinite(Date.parse(m.createdAt))
      )
        list.push({ id: name, createdAt: m.createdAt, files: m.files.length, ...historyMetadata(m), location:"local" });
    } catch {
      continue;
    }
  }
  return list;
}
ipcMain.handle("krysta:cloud-list", async (_e, shop: GameShop, id: string) => {
  const local = await gameContext(shop, id, true),
    list = await localEntries(local.base, local.root);
  // Offline pre-update copies remain available even when a remote provider cannot authenticate.
  try {
    const { base, root, provider, identity, remoteKey } = await gameContext(
      shop,
      id
    );
    for (const e of await localEntries(base, root))
      if (!list.some((existing) => existing.id === e.id)) list.push(e);
    if (provider) {
      const remote = await listRemoteCloudSnapshots(
        provider,
        identity!,
        remoteKey
      );
      for (const m of remote) {
        const existing = list.find(e => e.id === m.id);
        if (existing) existing.location = "both";
        else list.push({
            id: m.id,
            createdAt: m.createdAt,
            files: m.files.length,
            ...historyMetadata(m as typeof m & {kind?: unknown; deviceId?: unknown}),
            location:"cloud",
          });
      }
    }
  } catch (e) {
    if (!list.length) throw e;
  }
  return list.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id));
});
ipcMain.handle("krysta:cloud-open-pre-update-folder", async () => {
  const folder = path.join(
    app.getPath("userData"),
    "krysta-pre-update-backups"
  );
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  const st = await fs.lstat(folder);
  if (!st.isDirectory() || st.isSymbolicLink())
    throw Error("Unsafe local backup folder");
  const error = await shell.openPath(folder);
  if (error) throw Error("Cannot open backup folder");
});
type PendingCloudSave = {shop:GameShop; id:string; provider:"google"|"synology"; identity:string; version:string; expectedRemote:string|null; automatic?:boolean; attempts?:number; nextAttemptAt?:number};
const pendingCloudSaves = db.sublevel<string, PendingCloudSave>("krysta-pending-cloud-saves",{valueEncoding:"json"});
let pendingCloudBusy = false;
async function flushPendingCloudSaves() {
  if (pendingCloudBusy || !net.isOnline() || hasTrackedGamesRunning() || isGameBoostBackgroundSyncPaused()) return;
  pendingCloudBusy = true;
  try {
    for await (const [queueKey, item] of pendingCloudSaves.iterator()) {
      if (!net.isOnline() || hasTrackedGamesRunning()) break;
      if ((item.nextAttemptAt ?? 0) > Date.now()) continue;
      try {
        const current = await config();
        if (item.automatic && !current.autoBackup) continue;
        const ctx = await gameContext(item.shop,item.id);
        if (ctx.provider !== item.provider || ctx.identity !== item.identity) continue;
        await locked(ctx.key,async () => {
          if (hasTrackedGamesRunning()) return;
          const remote = await listRemoteCloudSnapshots(item.provider,item.identity,ctx.remoteKey);
          if (remote.some(m=>m.id===item.version)) { await pendingCloudSaves.del(queueKey); return; }
          if ((remote[0]?.id ?? null) !== item.expectedRemote) {
            await pendingCloudSaves.put(queueKey,{...item,nextAttemptAt:Date.now()+15*60_000});
            return;
          }
          if (!/^[a-f0-9-]{36}$/.test(item.version)) return;
          const dir = path.join(ctx.base,item.version);
          await safeDirectory(ctx.root,dir);
          const manifest = path.join(dir,"manifest.json");
          const manifestStat = await fs.lstat(manifest);
          if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > 8*1024**2) return;
          const m = JSON.parse(await fs.readFile(manifest,"utf8"));
          if (m.id!==item.version || !Array.isArray(m.files) || !m.files.length || m.files.length>5000) return;
          if (item.automatic && remote[0] && remote[0].files.length > m.files.length) {
            await pendingCloudSaves.put(queueKey,{...item,nextAttemptAt:Date.now()+15*60_000});
            return;
          }
          const names:string[] = [];
          for (const f of m.files) {
            if (hasTrackedGamesRunning() || isGameBoostBackgroundSyncPaused()) return;
            if (typeof f.name!=="string" || !/^\d+$/.test(f.name) || names.includes(f.name)) return;
            const file = path.join(dir,f.name), st = await fs.lstat(file);
            if (!st.isFile() || st.isSymbolicLink() || st.size!==f.size) return;
            if (f.sha256 !== undefined && (typeof f.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(f.sha256) || await fileHash(file) !== f.sha256)) throw Error("KRYSTA_INTEGRITY: Uszkodzona kopia lokalna");
            names.push(f.name);
          }
          const latest = await config();
          if (hasTrackedGamesRunning() || latest.provider!==item.provider || (item.automatic && !latest.autoBackup)) return;
          await uploadCloudSnapshot(item.provider,item.identity,ctx.remoteKey,item.version,dir,names, () => hasTrackedGamesRunning() || isGameBoostBackgroundSyncPaused());
          await pendingCloudSaves.del(queueKey);
        });
      } catch {
        const attempts = (item.attempts ?? 0)+1;
        await pendingCloudSaves.put(queueKey,{...item,attempts,nextAttemptAt:Date.now()+Math.min(3600_000,60_000*2**Math.min(attempts,6))}).catch(()=>{});
      }
    }
  } finally { pendingCloudBusy = false; }
}
const pendingCloudTimer = setInterval(() => { void flushPendingCloudSaves().catch(()=>{}); },60_000);
pendingCloudTimer.unref();
app.once("before-quit",()=>clearInterval(pendingCloudTimer));

async function backupGame(
  shop: GameShop,
  id: string,
  automatic = false,
  expected?: Config,
  beforeUpdate = false,
  signal?: AbortSignal
) {
  const { key, game, base, root, provider, identity, remoteKey } =
    await gameContext(shop, id, beforeUpdate);
  return locked(key, async () => {
    if (signal?.aborted) return false;
    if (isTrackedGameKeyRunning(key))
      throw Error("Close the game before backing up");
    if (automatic) {
      const c = await config();
      if (
        (automatic && !c.autoBackup) ||
        c.provider !== expected?.provider ||
        c.folder !== expected?.folder
      )
        return false;
    }
    const files = await discover(shop, id);
    if (signal?.aborted) return false;
    if (!files.length) {
      if (automatic) return false;
      throw Error(
        "KRYSTA_NO_SAVE_FILES: Ludusavi nie wykrył plików zapisów / No save files detected"
      );
    }
    if (files.length > 5000) throw Error("Too many save files");
    if (files.some((p) => within(root, p)))
      throw Error("Save files overlap cloud folder");
    const comparison = beforeUpdate
      ? { state: "no-backup", version: undefined }
      : await compareSaves(base, root, files);
    // A smaller detected save set can indicate accidental deletion or a failed scan.
    // Never promote it automatically; keep all previous snapshots untouched.
    if (automatic && "cloudFiles" in comparison && typeof comparison.cloudFiles === "number" && comparison.cloudFiles > files.length)
      throw Error("SAVE_CONFLICT: Wykryto mniej plików zapisów niż w poprzedniej kopii. Sprawdź historię w menu Chmura.");
    if (automatic && comparison.state === "same" && !provider) return false;
    if (provider && automatic && net.isOnline()) {
      const remote = await listRemoteCloudSnapshots(
        provider,
        identity!,
        remoteKey
      ).catch(error => {
        const message = String(error);
        if (/fetch failed|network|timeout|timed out|\b(?:408|429|500|502|503|504)\b/i.test(message))
          throw Error("KRYSTA_RETRYABLE_READ: " + message);
        throw error;
      });
      if (remote[0] && remote[0].files.length > files.length)
        throw Error("SAVE_CONFLICT: Brakuje lokalnych plików zapisów. Poprzednia kopia w chmurze została zachowana.");
      if (comparison.state === "same" && remote[0]?.id === comparison.version)
        return false;
      // A remote version unknown to this PC must not become superseded
      // by an automatic upload from an older local installation.
      if (remote.length && remote[0]?.id !== comparison.version)
        throw Error("SAVE_CONFLICT: Wykryto kopię z innego komputera. Wybierz wersję w menu Chmura.");

    }
    if (
      automatic &&
      !provider &&
      (comparison.state === "different" || comparison.state === "unavailable")
    )
      throw Error(
        "SAVE_CONFLICT: Local and cloud saves differ or cannot be verified. Open Cloud saves to choose a version."
      );
    if (!automatic && !beforeUpdate) {
      const answer = await dialog.showMessageBox({
        type: "question",
        buttons: ["Cancel", "Create backup"],
        defaultId: 0,
        cancelId: 0,
        message:
          comparison.state === "different"
            ? "Local and cloud saves differ. Keep local saves as a new backup without deleting previous versions? / Zapisy różnią się. Zachować lokalne jako nową kopię?"
            : "Create a copy of " +
              files.length +
              " detected save files in your selected cloud folder?",
      });
      if (answer.response !== 1) return false;
    }
    if (isTrackedGameKeyRunning(key)) throw Error("Game started before backup");
    await safeDirectory(root, base);
    const uuid = randomUUID(),
      temp = path.join(base, ".pending-" + uuid);
    await fs.mkdir(temp);
    try {
      const entries: { name: string; original: string; size: number; sha256: string }[] = [];
      let total = 0;
      for (const [i, p] of files.entries()) {
        if (signal?.aborted || isTrackedGameKeyRunning(key)) throw Error("Backup cancelled: game restarted");
        if (automatic) await waitForGameBoostBackgroundSync(signal);
        if (signal?.aborted || isTrackedGameKeyRunning(key)) throw Error("Backup cancelled: game restarted");
        const st = await fs.stat(p);
        total += st.size;
        if (total > 5 * 1024 ** 3) throw Error("Backup exceeds 5 GB");
        const name = String(i);
        const dest = path.join(temp, name);
        await copyVerified(p, dest);
        if (beforeUpdate) {
          const copied = await fs.stat(dest);
          if (
            copied.size !== st.size ||
            (await fileHash(p)) !== (await fileHash(dest))
          )
            throw Error("Local save backup verification failed");
          const after = await fs.stat(p);
          if (after.size !== st.size || after.mtimeMs !== st.mtimeMs)
            throw Error("Save changed during backup");
        }
        const sha256 = await fileHash(dest);
        if (sha256 !== await fileHash(p)) throw Error("KRYSTA_INTEGRITY: Save changed during backup");
        entries.push({ name, original: p, size: st.size, sha256 });
      }
      if (signal?.aborted || isTrackedGameKeyRunning(key))
        throw Error("Game started during backup");
      await fs.writeFile(
        path.join(temp, "manifest.json"),
        JSON.stringify({
          id: uuid,
          createdAt: new Date().toISOString(),
          deviceId: await cloudDeviceId(),
          kind: beforeUpdate
            ? "pre-update"
            : automatic
              ? "automatic"
              : "manual",
          files: entries,
        })
      );
      if (provider) {
        const current = await config();
        if (
          current.provider !== provider ||
          (await directCloudIdentity(provider)) !== identity
        )
          throw Error("Cloud provider changed");
        const queueKey = identity+":"+uuid;
        const item: PendingCloudSave = {shop,id,provider,identity:identity!,version:uuid,expectedRemote:comparison.version ?? null,automatic};
        const destination = path.join(base,uuid);
        await fs.rename(temp,destination);
        await pendingCloudSaves.put(queueKey,item);
        if (net.isOnline()) {
          try {
            await uploadCloudSnapshot(provider,identity!,remoteKey,uuid,destination,entries.map(e=>e.name), () => !!signal?.aborted || (automatic && (hasTrackedGamesRunning() || isGameBoostBackgroundSyncPaused())));
            await pendingCloudSaves.del(queueKey);
            await publishKrystaNotification("KRYSTA_CLOUD",game.title,"Kopia zapisów wykonana").catch(()=>{});
            return true;
          } catch { /* keep the same snapshot ID for retry */ }
        }
        await publishKrystaNotification("KRYSTA_CLOUD",game.title,"Kopia lokalna zapisana. Oczekuje na synchronizację.").catch(()=>{});
        return true;
      }
      await fs.rename(temp, path.join(base, uuid));
      await publishKrystaNotification(
        "KRYSTA_CLOUD",
        game.title,
        beforeUpdate
          ? "Lokalna kopia zapisów przed aktualizacją / Local pre-update save backup"
          : "Kopia zapisów wykonana / Save backup completed"
      ).catch(() => {});
      return true;
    } catch (e) {
      await fs.rm(temp, { recursive: true, force: true });
      throw e;
    }
  });
}
export async function backupBeforeGameUpdate(shop: GameShop, id: string) {
  return backupGame(shop, id, false, undefined, true);
}
ipcMain.handle("krysta:cloud-backup", (_e, shop: GameShop, id: string) =>
  backupGame(shop, id)
);

// Disaster recovery exports verified copies to a user-selected directory.
 // Never write to a path supplied by a remote manifest.
ipcMain.handle("krysta:cloud-recovery-export", async (_e, shop:GameShop,id:string,version:unknown) => {
  if (typeof version !== "string" || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(version)) throw Error("Invalid version");
  const ctx = await gameContext(shop,id);
  if (!ctx.provider || !ctx.identity) throw Error("Select a cloud account");
  const selected = await dialog.showOpenDialog({properties:["openDirectory","createDirectory"],title:"Wybierz folder odzyskiwania zapisów"});
  if (selected.canceled || !selected.filePaths[0]) return false;
  return locked(ctx.key,async () => {
    if (hasTrackedGamesRunning()) throw Error("Zamknij grę przed odzyskiwaniem");
    const root = await fs.realpath(selected.filePaths[0]);
    const dest = path.join(root,"Krysta-Recovery-"+version);
    const temp = path.join(root,".krysta-recovery-"+randomUUID());
    await fs.mkdir(temp,{mode:0o700});
    try {
      await downloadCloudSnapshot(ctx.provider!,ctx.identity!,ctx.remoteKey,version,temp);
      // Exclusive directory creation prevents overwriting an earlier recovery.
      await fs.mkdir(dest,{mode:0o700});
      try {
        for (const name of await fs.readdir(temp)) {
          if (name !== "manifest.json" && !/^\d+$/.test(name)) throw Error("Invalid recovery file");
          await copyVerified(path.join(temp,name),path.join(dest,name));
        }
      } catch(e) { throw Error("Niepełny eksport odzyskiwania: "+dest+" / "+String(e)); }
      return true;
    } finally { await fs.rm(temp,{recursive:true,force:true}); }
  });
});

/* Restore only files independently detected for this game on this PC.
 * The remote manifest is never trusted to choose a writable destination. */
async function restoreGame(shop: GameShop, id: string, version: unknown) {
  if (
    typeof version !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      version
    )
  )
    throw Error("Invalid backup version");
  const local = await gameContext(shop, id, true);
  const foundLocal = await fs
    .lstat(path.join(local.base, version))
    .then(() => true)
    .catch((e) => {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw e;
    });
  const { key, base, root, provider, identity, remoteKey } = foundLocal
    ? local
    : await gameContext(shop, id);
  return locked(key, async () => {
    if (isTrackedGameKeyRunning(key))
      throw Error("Close the game before restoring");
    await safeDirectory(root, base);
    const dir = path.join(base, version);
    if (provider && !(await fs.lstat(dir).catch(() => null))) {
      const temp = path.join(base, ".pending-" + randomUUID());
      await fs.mkdir(temp);
      try {
        await downloadCloudSnapshot(
          provider,
          identity!,
          remoteKey,
          version,
          temp
        );
        await fs.rename(temp, dir);
      } catch (e) {
        await fs.rm(temp, { recursive: true, force: true });
        throw e;
      }
    }
    if ((await fs.realpath(dir)) !== dir)
      throw Error("Unsafe backup directory");
    const manifestPath = path.join(dir, "manifest.json");
    const manifestStat = await fs.lstat(manifestPath);
    if (
      !manifestStat.isFile() ||
      manifestStat.isSymbolicLink() ||
      manifestStat.size > 8 * 1024 ** 2
    )
      throw Error("Invalid backup manifest");
    const m = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    if (
      m.id !== version ||
      !Array.isArray(m.files) ||
      !m.files.length ||
      m.files.length > 5000
    )
      throw Error("Invalid backup manifest");
    const current = await discover(shop, id);
    const allowed = new Set(
      current.map((p) => (process.platform === "win32" ? p.toLowerCase() : p))
    );
    const seen = new Set<string>();
    const files: { src: string; dst: string; size: number }[] = [];
    let total = 0;
    for (const entry of m.files) {
      if (
        !entry ||
        typeof entry.original !== "string" ||
        typeof entry.name !== "string" ||
        !/^[0-9]+$/.test(entry.name) ||
        !Number.isSafeInteger(entry.size) ||
        entry.size < 0
      )
        throw Error("Invalid backup entry");
      const candidate = path.normalize(entry.original);
      const destKey =
        process.platform === "win32" ? candidate.toLowerCase() : candidate;
      if (!allowed.has(destKey) || seen.has(destKey) || within(root, candidate))
        throw Error(
          "Save destination not recognized on this computer. Restore requires matching detected local files."
        );
      seen.add(destKey);
      const dst = current.find(
        (p) => (process.platform === "win32" ? p.toLowerCase() : p) === destKey
      )!;
      const src = path.join(dir, entry.name);
      const st = await fs.lstat(src);
      if (
        !st.isFile() ||
        st.isSymbolicLink() ||
        st.size !== entry.size ||
        (await fs.realpath(src)) !== src
      )
        throw Error("Backup file missing, incomplete or unsafe");
      if (entry.sha256 !== undefined && (typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256) || await fileHash(src) !== entry.sha256)) throw Error("KRYSTA_INTEGRITY: Uszkodzona kopia zapisu");
      total += st.size;
      if (total > 5 * 1024 ** 3) throw Error("Backup exceeds 5 GB");
      files.push({ src, dst, size: st.size });
    }
    const restoreBaseline = new Map<string, {size:number; mtimeMs:number; hash:string}>();
    for (const f of files) {
      const st = await fs.lstat(f.dst);
      if (!st.isFile() || st.isSymbolicLink()) throw Error("Unsafe save destination");
      const hash = await fileHash(f.dst);
      const after = await fs.lstat(f.dst);
      if (st.size !== after.size || st.mtimeMs !== after.mtimeMs) throw Error("Save changed during verification");
      restoreBaseline.set(f.dst,{size:st.size,mtimeMs:st.mtimeMs,hash});
    }
    const backupDate = typeof m.createdAt === "string" ? Date.parse(m.createdAt) : NaN;
    const possiblyNewer = !Number.isFinite(backupDate) || [...restoreBaseline.values()].some(st => st.mtimeMs > backupDate);
    const answer = await dialog.showMessageBox({
      type: "warning",
      buttons: ["Cancel / Anuluj", "Restore / Przywróć"],
      defaultId: 0,
      cancelId: 0,
      message:
        possiblyNewer ? "Lokalne zapisy mogą być nowsze. Przywrócić starszą kopię? / Local saves may be newer. Restore anyway?" : "Restore selected save version? / Przywrócić wybraną wersję zapisów?",
      detail:
        "Existing save files will be backed up before replacement. Close the game first. / Aktualne pliki zostaną skopiowane przed nadpisaniem. Zamknij grę.",
    });
    if (answer.response !== 1) return false;
    if (isTrackedGameKeyRunning(key))
      throw Error("Close the game before restoring");
    const safetyId = randomUUID(),
      pending = path.join(base, ".pending-" + safetyId);
    await fs.mkdir(pending);
    try {
      const entries: { name: string; original: string; size: number; sha256: string }[] = [];
      for (const [i, f] of files.entries()) {
        const st = await fs.lstat(f.dst);
        if (
          !st.isFile() ||
          st.isSymbolicLink() ||
          (await fs.realpath(f.dst)) !== f.dst
        )
          throw Error("Save destination changed");
        const name = String(i);
        await copyVerified(f.dst, path.join(pending, name));
        const baseline = restoreBaseline.get(f.dst)!;
        if (st.size !== baseline.size || st.mtimeMs !== baseline.mtimeMs || await fileHash(path.join(pending,name)) !== baseline.hash)
          throw Error("SAVE_CONFLICT: Lokalny zapis zmienił się po potwierdzeniu.");
        entries.push({ name, original: f.dst, size: st.size, sha256: baseline.hash });
      }
      await fs.writeFile(
        path.join(pending, "manifest.json"),
        JSON.stringify({
          id: safetyId,
          createdAt: new Date().toISOString(),
          kind: "before-restore",
          files: entries,
        })
      );
      await fs.rename(pending, path.join(base, safetyId));
    } catch (e) {
      await fs.rm(pending, { recursive: true, force: true });
      throw e;
    }
    const safety = path.join(base, safetyId);
    const changed: number[] = [];
    async function replace(src: string, dst: string) {
      if ((await fs.realpath(dst)) !== dst) throw Error("Unsafe destination");
      const tmp = path.join(
        path.dirname(dst),
        ".krysta-restore-" + randomUUID() + ".tmp"
      );
      try {
        await copyVerified(src, tmp);
        if ((await fs.realpath(dst)) !== dst)
          throw Error("Destination changed");
        await fs.rename(tmp, dst);
      } finally {
        await fs.rm(tmp, { force: true }).catch(() => {});
      }
    }
    try {
      for (const [i, f] of files.entries()) {
        if (isTrackedGameKeyRunning(key))
          throw Error("Game started during restore");
        const baseline = restoreBaseline.get(f.dst)!;
        const st = await fs.lstat(f.dst);
        if (st.size !== baseline.size || st.mtimeMs !== baseline.mtimeMs || await fileHash(f.dst) !== baseline.hash) throw Error("SAVE_CONFLICT: Lokalny zapis zmienił się przed przywróceniem.");
        await replace(f.src, f.dst);
        changed.push(i);
      }
      return true;
    } catch (e) {
      const failures: number[] = [];
      for (const i of changed.reverse()) {
        try {
          await replace(path.join(safety, String(i)), files[i].dst);
        } catch {
          failures.push(i);
        }
      }
      if (failures.length)
        throw Error(
          "Restore failed; rollback incomplete. Safety backup: " + safetyId
        );
      throw e;
    }
  });
}
ipcMain.handle(
  "krysta:cloud-restore",
  (_e, shop: GameShop, id: string, version: unknown) =>
    restoreGame(shop, id, version)
);

const achievementBackupState = db.sublevel<string, string>("krysta-google-achievement-backup", { valueEncoding: "json" });
let achievementBackupBusy = false;
async function backupAchievementsToGoogle(expected: Config, signal: AbortSignal) {
  if (achievementBackupBusy || signal.aborted || expected.provider !== "google" || !expected.autoBackup) return;
  achievementBackupBusy = true;
  try {
    await waitForGameBoostBackgroundSync(signal);
    const current = await config();
    if (signal.aborted || current.provider !== "google" || !current.autoBackup || gamesPlaytime.size) return;
    const identity = await directCloudIdentity("google");
    const games = Array.from(AchievementMemoryStore.all(), ([key, entry]) => ({
      key, unlocked: entry.unlockedAchievements.filter(a => typeof a.name === "string" && Number.isFinite(a.unlockTime) && a.unlockTime > 0).map(a => ({ name: a.name, unlockTime: a.unlockTime, hardcoreUnlockTime: a.hardcoreUnlockTime }))
    })).filter(g => g.unlocked.length);
    if (!games.length) return;
    const hash = digest(JSON.stringify(games));
    if (await achievementBackupState.get(identity).catch(() => undefined) === hash) return;
    if (signal.aborted || gamesPlaytime.size || (await config()).provider !== "google") return;
    await uploadAchievementBackup(identity, JSON.stringify({ version: 1, createdAt: new Date().toISOString(), games }));
    await achievementBackupState.put(identity, hash);
  } finally { achievementBackupBusy = false; }
}
const automaticStoryBackup = db.sublevel<string, AutomaticGameStoryProgress | { automatic: AutomaticGameStoryProgress | null }>("automatic-story-progress", { valueEncoding: "json" });
const manualStoryBackup = db.sublevel<string, GameStoryProgress>("game-story-progress", { valueEncoding: "json" });
let storyBackupBusy = false;
async function backupStoryToGoogle(expected: Config, signal: AbortSignal) {
  if (storyBackupBusy || signal.aborted || expected.provider !== "google" || !expected.autoBackup) return;
  storyBackupBusy = true;
  try {
    await waitForGameBoostBackgroundSync(signal);
    const current = await config();
    if (signal.aborted || current.provider !== "google" || !current.autoBackup || gamesPlaytime.size) return;
    const identity = await directCloudIdentity("google");
    const automatic = (await automaticStoryBackup.iterator().all()).flatMap(([key, value]) => {
      const a = "automatic" in value ? value.automatic : value;
      if (!a) return [];
      return [{ key, percent: a.percent, saveTitle: a.saveTitle, saveTitleKind: a.saveTitleKind, missionDescription: a.missionDescription, progressKind: a.progressKind, completedMissions: a.completedMissions, totalMissions: a.totalMissions, savedAt: a.savedAt, trackedQuestId: a.trackedQuestId, summaryKey: a.summaryKey }];
    });
    const manual = (await manualStoryBackup.iterator().all()).map(([key, a]) => ({ key, percent: a.percent, missionName: a.missionName, missionDescription: a.missionDescription }));
    if (!automatic.length && !manual.length) return;
    const hash = digest(JSON.stringify({ automatic, manual }));
    const stateKey = "story:" + identity;
    if (await achievementBackupState.get(stateKey).catch(() => undefined) === hash) return;
    const latest = await config();
    if (signal.aborted || gamesPlaytime.size || latest.provider !== "google" || !latest.autoBackup) return;
    await uploadAchievementBackup(identity, JSON.stringify({ version: 1, createdAt: new Date().toISOString(), automatic, manual }), "story");
    await achievementBackupState.put(stateKey, hash);
  } finally { storyBackupBusy = false; }
}
let libraryBackupBusy = false;
async function backupLibraryToGoogle(expected: Config, signal: AbortSignal) {
  if (libraryBackupBusy || signal.aborted || expected.provider !== "google" || !expected.autoBackup) return;
  libraryBackupBusy = true;
  try {
    await waitForGameBoostBackgroundSync(signal);
    const current = await config();
    if (signal.aborted || current.provider !== "google" || !current.autoBackup || gamesPlaytime.size) return;
    const identity = await directCloudIdentity("google");
    const games: { shop: string; objectId: string; title: string; favorite?: boolean; isPinned?: boolean; playTimeInMilliseconds: number; collectionIds?: string[]; collectionPositions?: Record<string, number> }[] = [];
    for await (const game of gamesSublevel.values()) {
      if (signal.aborted || gamesPlaytime.size) return;
      if (game.isDeleted) continue;
      games.push({ shop: game.shop, objectId: game.objectId, title: game.title, favorite: game.favorite, isPinned: game.isPinned, playTimeInMilliseconds: game.playTimeInMilliseconds, collectionIds: game.collectionIds, collectionPositions: game.collectionPositions });
    }
    if (!games.length) return;
    games.sort((a, b) => (a.shop + ":" + a.objectId).localeCompare(b.shop + ":" + b.objectId));
    const hash = digest(JSON.stringify(games));
    const stateKey = "library:" + identity;
    if (await achievementBackupState.get(stateKey).catch(() => undefined) === hash) return;
    const latest = await config();
    if (signal.aborted || gamesPlaytime.size || latest.provider !== "google" || !latest.autoBackup) return;
    await uploadAchievementBackup(identity, JSON.stringify({ version: 1, createdAt: new Date().toISOString(), games }), "library");
    await achievementBackupState.put(stateKey, hash);
  } finally { libraryBackupBusy = false; }
}
let settingsBackupBusy = false;
async function backupSettingsToGoogle(expected: Config, signal: AbortSignal) {
  if (settingsBackupBusy || signal.aborted || expected.provider !== "google" || !expected.autoBackup) return;
  settingsBackupBusy = true;
  try {
    await waitForGameBoostBackgroundSync(signal);
    const current = await config();
    if (signal.aborted || gamesPlaytime.size || current.provider !== "google" || !current.autoBackup) return;
    const identity = await directCloudIdentity("google");
    const pick = (source: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter(key => ["boolean", "number", "string"].includes(typeof source[key])).map(key => [key, source[key]]));
    const preferences = await db.get<string, Record<string, unknown>>(levelKeys.userPreferences, {valueEncoding:"json"});
    const root = app.getPath("userData");
    const fps = await readKrystaSettings<Record<string, unknown>>(root, "fps");
    const updates = await readKrystaSettings<Record<string, unknown>>(root, "updates");
    const gameUpdates = await readKrystaSettings<Record<string, unknown>>(root, "game-updates");
    const settings = {
      preferences: pick(preferences ?? {}, ["language", "gameBoostEnabled", "enableSteamAchievements", "achievementNotificationsEnabled", "achievementSoundVolume", "screenshotsEnabled", "startMinimized", "launchToLibraryPage"]),
      fps: pick(fps, ["enabled", "position", "output", "hotkey"]),
      updates: pick(updates, ["automatic", "notifications"]),
      gameUpdates: pick(gameUpdates, ["enabled", "intervalHours", "notifications", "startup", "pauseDuringPlay", "autoOpenSteamQueue", "autoDownloadEpic", "backupBeforeUpdate"])
    };
    const hash = digest(JSON.stringify(settings));
    const stateKey = "settings:" + identity;
    if (await achievementBackupState.get(stateKey).catch(() => undefined) === hash) return;
    const latest = await config();
    if (signal.aborted || gamesPlaytime.size || latest.provider !== "google" || !latest.autoBackup) return;
    await uploadAchievementBackup(identity, JSON.stringify({ version: 1, createdAt: new Date().toISOString(), settings }), "settings");
    await achievementBackupState.put(stateKey, hash);
  } finally { settingsBackupBusy = false; }
}
let mediaBusy = false;
async function backupMediaToGoogle(c: Config, signal: AbortSignal) {
  if (mediaBusy || c.provider !== "google" || !c.autoBackup || (!c.backupScreenshots && !c.backupRecordings)) return;
  mediaBusy = true;
  try {
    const identity = await directCloudIdentity("google");
    const allowed = async (kind: "backupScreenshots" | "backupRecordings") => {
      await waitForGameBoostBackgroundSync(signal);
      const latest = await config();
      return !signal.aborted && !hasTrackedGamesRunning() && latest.provider === "google" && latest.autoBackup && latest[kind] === true;
    };
    const send = async (name: string, bytes: Uint8Array) => {
      const hash = createHash("sha256").update(bytes).digest("hex");
      const key = "media:" + identity + ":" + hash;
      if (await achievementBackupState.get(key).catch(() => undefined)) return;
      await uploadGoogleMedia(identity, name, bytes, hash, AbortSignal.any([signal, AbortSignal.timeout(120000)]));
      await achievementBackupState.put(key, hash);
    };
    if (c.backupScreenshots && await allowed("backupScreenshots")) {
      for (const shot of await getLocalScreenshots()) {
        if (!await allowed("backupScreenshots")) break;
        const ext = path.extname(shot.path).toLowerCase();
        if (![".png",".jpg",".jpeg",".webp"].includes(ext)) continue;
        const st = await fs.lstat(shot.path).catch(() => null);
        if (!st?.isFile() || st.isSymbolicLink() || st.size > 16 * 1024 ** 2) continue;
        const bytes = await fs.readFile(shot.path);
        if (await allowed("backupScreenshots")) await send("Krysta-screenshot-" + shot.clientId + ext, bytes);
      }
    }
    if (c.backupRecordings && await allowed("backupRecordings")) {
      for (const clip of (await recordingState()).clips) {
        if (!await allowed("backupRecordings")) break;
        if (clip.size > 96 * 1024 ** 2) continue;
        const bytes = await readRecording(clip.id);
        if (await allowed("backupRecordings")) await send("Krysta-recording-" + clip.id + "." + clip.format, bytes);
      }
    }
  } finally { mediaBusy = false; }
}
ipcMain.handle("krysta:cloud-media", async (_e, kind: unknown, enabled: unknown) => {
  if ((kind !== "backupScreenshots" && kind !== "backupRecordings") || typeof enabled !== "boolean") throw Error("Invalid media setting");
  const c = await config();
  if (c.provider !== "google") throw Error("Select Google Drive");
  if (enabled) await directCloudIdentity("google");
  return save({...c, [kind]: enabled});
});
type AutoResult = {
  state: "saved" | "skipped" | "error";
  at: string;
  message?: string;
};
const autoResults = new Map<string, AutoResult>();
const pendingAuto = new Map<
  string,
  { timer: ReturnType<typeof setTimeout>; controller: AbortController }
>();
const cancelAutomaticBackup = (key: string) => {
  const pending = pendingAuto.get(key);
  if (!pending) return;
  clearTimeout(pending.timer);
  pending.controller.abort();
  pendingAuto.delete(key);
};
let previousRunning = new Set<string>();
let shuttingDown = false;
ipcMain.handle("krysta:cloud-auto", async (_e, enabled: unknown) => {
  if (typeof enabled !== "boolean")
    throw Error("Invalid automatic backup setting");
  const c = await config();
  if (enabled) {
    if (c.provider === "hydra" || (c.provider === "local" && !c.folder))
      throw Error("Select a backup destination first");
    if (c.provider === "google" || c.provider === "synology")
      await directCloudIdentity(c.provider);
  }
  if (enabled) {
    const answer = await dialog.showMessageBox({
      type: "question",
      buttons: ["Anuluj / Cancel", "Włącz / Enable"],
      defaultId: 0,
      cancelId: 0,
      message:
        "Automatycznie kopiować wykryte zapisy wszystkich obsługiwanych gier do wybranego folderu? / Automatically back up detected saves for all supported games to the selected folder?",
    });
    if (answer.response !== 1) return c;
  } else {
    for (const key of pendingAuto.keys()) cancelAutomaticBackup(key);
  }
  return save({ ...c, autoBackup: enabled });
});
ipcMain.handle(
  "krysta:cloud-auto-status",
  (_e, shop: GameShop, id: string) =>
    autoResults.get(levelKeys.game(shop, id)) ?? null
);
onTrackedGamesRunningChange(() => {
  const now = new Set(gamesPlaytime.keys());
  for (const key of now) cancelAutomaticBackup(key);
  for (const key of previousRunning) {
    if (now.has(key) || shuttingDown || pendingAuto.has(key)) continue;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        await waitForGameBoostBackgroundSync(controller.signal);
        const c = await config();
        if (
          shuttingDown ||
          controller.signal.aborted ||
          !c.autoBackup ||
          c.provider === "hydra" ||
          (c.provider === "local" && !c.folder) ||
          isTrackedGameKeyRunning(key)
        )
          return;
        const game = await gamesSublevel.get(key);
        if (!game || game.isDeleted || controller.signal.aborted) return;
        await waitForGameBoostBackgroundSync(controller.signal);
        if (controller.signal.aborted || isTrackedGameKeyRunning(key)) return;
        // Retry only read-side transient failures; an ambiguous upload must
        // never be repeated with a new snapshot ID.
        let done: boolean;
        const delays = [5000, 15000, 60000];
        for (let attempt = 0; ; attempt++) {
          try {
            done = await backupGame(game.shop, game.objectId, true, c, false, controller.signal);
            break;
          } catch (error) {
            if (!(error instanceof Error) || !error.message.startsWith("KRYSTA_RETRYABLE_READ:") || attempt >= delays.length || controller.signal.aborted) throw error;
            await new Promise<void>(resolve => {
              const finish = () => { clearTimeout(timer); controller.signal.removeEventListener("abort",finish); resolve(); };
              const timer = setTimeout(finish,delays[attempt]);
              controller.signal.addEventListener("abort",finish,{once:true});
              if (controller.signal.aborted) finish();
            });
            if (controller.signal.aborted || isTrackedGameKeyRunning(key)) return;
            const latest = await config();
            if (!latest.autoBackup || latest.provider !== c.provider || latest.folder !== c.folder) return;
            await waitForGameBoostBackgroundSync(controller.signal);
            if (controller.signal.aborted) return;
          }
        }
        if (controller.signal.aborted) return;
        await backupAchievementsToGoogle(c, controller.signal).catch(() => {
          void publishKrystaNotification("KRYSTA_ERROR", game.title, "Kopia osiągnięć Google Drive nie powiodła się").catch(() => {});
        });
        await backupStoryToGoogle(c, controller.signal).catch(() => {
          void publishKrystaNotification("KRYSTA_ERROR", game.title, "Kopia postępu fabularnego Google Drive nie powiodła się").catch(() => {});
        });
        await backupLibraryToGoogle(c, controller.signal).catch(() => {
          void publishKrystaNotification("KRYSTA_ERROR", game.title, "Kopia biblioteki Google Drive nie powiodła się").catch(() => {});
        });
        await backupSettingsToGoogle(c, controller.signal).catch(() => {
          void publishKrystaNotification("KRYSTA_ERROR", game.title, "Kopia ustawień Google Drive nie powiodła się").catch(() => {});
        });
        await backupMediaToGoogle(c, controller.signal).catch(() => {
          if (!controller.signal.aborted) void publishKrystaNotification("KRYSTA_ERROR", game.title, "Kopia multimediów Google Drive nie powiodła się").catch(() => {});
        });
        autoResults.set(key, {
          state: done ? "saved" : "skipped",
          at: new Date().toISOString(),
        });
      })()
        .catch((e) => {
          if (controller.signal.aborted) return;
          autoResults.set(key, {
            state: "error",
            at: new Date().toISOString(),
            message: String(e),
          });
          void gamesSublevel
            .get(key)
            .then((game) =>
              publishKrystaNotification(
                "KRYSTA_ERROR",
                game?.title ?? "Krysta Cloud",
                "Automatyczna kopia zapisów nie powiodła się / Automatic save backup failed"
              )
            )
            .catch(() => {});
        })
        .finally(() => {
          if (pendingAuto.get(key)?.controller === controller)
            pendingAuto.delete(key);
        });
    }, 15000);
    pendingAuto.set(key, { timer, controller });
  }
  previousRunning = now;
});
app.on("before-quit", () => {
  shuttingDown = true;
  for (const key of pendingAuto.keys()) cancelAutomaticBackup(key);
});

type Comparison = {
  state: "same" | "different" | "no-backup" | "unavailable";
  version?: string;
  createdAt?: string;
  localFiles: number;
  cloudFiles: number;
};
async function fileHash(file: string) {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return h.digest("hex");
}
const comparablePath = (p: string) =>
  process.platform === "win32"
    ? path.normalize(p).toLowerCase()
    : path.normalize(p);
async function compareSaves(
  base: string,
  root: string,
  files: string[]
): Promise<Comparison> {
  await safeDirectory(root, base);
  const versions: {
    id: string;
    createdAt: string;
    dir: string;
    files: unknown[];
  }[] = [];
  let incomplete = false;
  for (const id of await fs.readdir(base)) {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id)) continue;
    try {
      const dir = path.join(base, id);
      if ((await fs.realpath(dir)) !== dir) throw Error("Unsafe version");
      const mp = path.join(dir, "manifest.json"),
        s = await fs.lstat(mp);
      if (!s.isFile() || s.isSymbolicLink() || s.size > 8 * 1024 ** 2)
        throw Error("Invalid manifest");
      const m = JSON.parse(await fs.readFile(mp, "utf8"));
      if (
        m.id !== id ||
        !Array.isArray(m.files) ||
        !m.files.length ||
        m.files.length > 5000 ||
        typeof m.createdAt !== "string" ||
        !Number.isFinite(Date.parse(m.createdAt))
      )
        throw Error("Invalid version");
      if (m.kind !== "before-restore")
        versions.push({ id, createdAt: m.createdAt, dir, files: m.files });
    } catch {
      incomplete = true;
    }
  }
  const latest = versions.sort(
    (a, b) =>
      Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
      b.id.localeCompare(a.id)
  )[0];
  const result: Comparison = {
    state: "unavailable",
    version: latest?.id,
    createdAt: latest?.createdAt,
    localFiles: files.length,
    cloudFiles: latest?.files.length ?? 0,
  };
  if (incomplete) return result;
  if (!latest) return { ...result, state: "no-backup" };
  if (!files.length) return result;
  const locals = new Map(files.map((p) => [comparablePath(p), p]));
  let same = locals.size === latest.files.length,
    total = 0;
  const seen = new Set<string>();
  try {
    for (const entry of latest.files) {
      const e = entry as { original?: unknown; name?: unknown; size?: unknown };
      if (
        !e ||
        typeof e.original !== "string" ||
        typeof e.name !== "string" ||
        !/^\d+$/.test(e.name) ||
        typeof e.size !== "number" ||
        !Number.isSafeInteger(e.size) ||
        e.size < 0
      )
        throw Error("Invalid entry");
      const key = comparablePath(e.original);
      if (seen.has(key)) throw Error("Duplicate destination");
      seen.add(key);
      const src = path.join(latest.dir, e.name),
        st = await fs.lstat(src);
      if (
        !st.isFile() ||
        st.isSymbolicLink() ||
        st.size !== e.size ||
        (await fs.realpath(src)) !== src
      )
        throw Error("Incomplete backup");
      total += st.size;
      if (total > 5 * 1024 ** 3) throw Error("Too large");
      const local = locals.get(key);
      if (!local) {
        same = false;
        continue;
      }
      const before = await fs.lstat(local);
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        (await fs.realpath(local)) !== local
      )
        throw Error("Unsafe local file");
      if (
        before.size !== st.size ||
        (await fileHash(local)) !== (await fileHash(src))
      )
        same = false;
      const after = await fs.stat(local),
        remoteAfter = await fs.stat(src);
      if (
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        st.size !== remoteAfter.size ||
        st.mtimeMs !== remoteAfter.mtimeMs
      )
        throw Error("Files changed while comparing");
    }
  } catch {
    return result;
  }
  return { ...result, state: same ? "same" : "different" };
}
ipcMain.handle(
  "krysta:cloud-compare",
  async (_e, shop: GameShop, id: string) => {
    const { key, base, root, provider, identity, remoteKey } = await gameContext(shop, id);
    return locked(key, async () => {
      if (isTrackedGameKeyRunning(key))
        throw Error("Close the game before comparing saves");
      const files = await discover(shop, id);
      if (!provider || !identity) return compareSaves(base, root, files);
      try {
        const remote = (await listRemoteCloudSnapshots(provider, identity, remoteKey))[0];
        if (!remote) return {state:"no-backup",localFiles:files.length,cloudFiles:0};
        const result: Comparison = {state:"unavailable",version:remote.id,createdAt:remote.createdAt,localFiles:files.length,cloudFiles:remote.files.length};
        if (!files.length || isTrackedGameKeyRunning(key)) return result;
        await safeDirectory(root, base);
        const temp = path.join(base, ".compare-" + randomUUID());
        await fs.mkdir(temp);
        try {
          await downloadCloudSnapshot(provider, identity, remoteKey, remote.id, temp);
          const locals = new Map(files.map(p => [comparablePath(p),p]));
          let same = locals.size === remote.files.length;
          for (const entry of remote.files) {
            if (isTrackedGameKeyRunning(key)) return result;
            const target = locals.get(comparablePath(entry.original));
            if (!target) { same = false; continue; }
            const before = await fs.lstat(target);
            if (!before.isFile() || before.isSymbolicLink()) return result;
            if (before.size !== entry.size || await fileHash(target) !== await fileHash(path.join(temp,entry.name))) same = false;
            const after = await fs.lstat(target);
            if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) return result;
          }
          return {...result,state:same ? "same" : "different"};
        } finally { await fs.rm(temp,{recursive:true,force:true}); }
      } catch {
        return {state:"unavailable",localFiles:files.length,cloudFiles:0};
      }
    });
  }
);

ipcMain.handle(
  "krysta:cloud-sync-before-launch",
  async (_e, enabled: unknown) => {
    if (typeof enabled !== "boolean") throw Error("Invalid sync setting");
    const c = await config();
    if (enabled) {
      if (c.provider !== "google" && c.provider !== "synology")
        throw Error("Select a direct cloud provider");
      await directCloudIdentity(c.provider);
    }
    return save({ ...c, syncBeforeLaunch: enabled });
  }
);
const launchSyncs = new Set<string>();
export async function syncKrystaCloudBeforeLaunch(
  shop: GameShop,
  id: string
): Promise<boolean> {
  const c = await config();
  if (
    !c.syncBeforeLaunch ||
    (c.provider !== "google" && c.provider !== "synology") ||
    shop === "launchbox"
  )
    return true;
  const gameKey = levelKeys.game(shop, id);
  if (launchSyncs.has(gameKey)) return false;
  launchSyncs.add(gameKey);
  try {
    const { key, base, root, provider, identity, remoteKey, game } =
      await gameContext(shop, id);
    if (!provider || !identity) return true;
    if (isTrackedGameKeyRunning(key)) return false;
    const latest = await locked(key, async () => {
      const versions = await listRemoteCloudSnapshots(
        provider,
        identity,
        remoteKey
      );
      const remote = versions[0];
      if (!remote) return null;
      const current = await discover(shop, id);
      await safeDirectory(root, base);
      const dir = path.join(base, remote.id);
      if (!(await fs.lstat(dir).catch(() => null))) {
        const temp = path.join(base, ".pending-" + randomUUID());
        await fs.mkdir(temp);
        try {
          await downloadCloudSnapshot(
            provider,
            identity,
            remoteKey,
            remote.id,
            temp
          );
          await fs.rename(temp, dir);
        } catch (e) {
          await fs.rm(temp, { recursive: true, force: true });
          throw e;
        }
      }
      if ((await fs.realpath(dir)) !== dir) throw Error("Unsafe snapshot");
      const local = new Map(current.map((p) => [comparablePath(p), p]));
      let same = local.size === remote.files.length,
        canRestore = true;
      for (const entry of remote.files) {
        const target = local.get(comparablePath(entry.original));
        if (!target) {
          same = false;
          canRestore = false;
          continue;
        }
        const source = path.join(dir, entry.name),
          st = await fs.lstat(source);
        if (
          !st.isFile() ||
          st.isSymbolicLink() ||
          st.size !== entry.size ||
          (await fs.realpath(source)) !== source
        )
          throw Error("Incomplete snapshot");
        if ((await fileHash(target)) !== (await fileHash(source))) same = false;
      }
      return same ? null : { remote, canRestore, title: game.title };
    });
    if (!latest) return true;
    const options = latest.canRestore
      ? [
          "Cancel / Anuluj",
          "Use local / Użyj lokalnych",
          "Restore cloud / Przywróć z chmury",
        ]
      : ["Cancel / Anuluj", "Use local / Użyj lokalnych"];
    const answer = await dialog.showMessageBox({
      type: "warning",
      buttons: options,
      defaultId: 0,
      cancelId: 0,
      message: "Krysta Cloud — " + latest.title,
      detail:
        "Cloud and local saves differ. / Zapisy w chmurze i lokalne różnią się. " +
        new Date(latest.remote.createdAt).toLocaleString() +
        (latest.canRestore
          ? ""
          : "\nNie wykryto zgodnych lokalnych ścieżek; przywracanie niedostępne."),
    });
    if (answer.response === 1) return true;
    if (answer.response !== 2 || !latest.canRestore) return false;
    const now = await config();
    if (
      !now.syncBeforeLaunch ||
      now.provider !== provider ||
      (await directCloudIdentity(provider)) !== identity
    )
      return false;
    return await restoreGame(shop, id, latest.remote.id);
  } catch {
    const answer = await dialog.showMessageBox({
      type: "warning",
      buttons: ["Cancel / Anuluj", "Play offline / Graj bez synchronizacji"],
      defaultId: 0,
      cancelId: 0,
      message:
        "Krysta Cloud: nie można zweryfikować zapisów / Unable to verify saves",
    });
    return answer.response === 1;
  } finally {
    launchSyncs.delete(gameKey);
  }
}
