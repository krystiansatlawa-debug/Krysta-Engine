import {
  readKrystaSettings,
  writeKrystaSettings,
} from "@main/services/krysta-settings-recovery";
import { app, ipcMain, Notification, shell } from "electron";
import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { hasTrackedGamesRunning } from "@main/services/game-running-state";

const repo = "krystiansatlawa-debug/Krysta-Engine";
const releasePage = "https://github.com/" + repo + "/releases";
const maxBytes = 2 * 1024 ** 3;
type Asset = { name: string; url: string; size: number; sha256: string };
type Release = {
  tag: string;
  body: string;
  publishedAt: string;
  asset: Asset | null;
};
type Prefs = { automatic: boolean; notifications: boolean; seen?: string };
type Status = {
  phase: "idle" | "checking" | "downloading" | "ready" | "manual" | "error";
  version: string;
  received: number;
  total: number;
  error?: string;
};
let status: Status = { phase: "idle", version: "", received: 0, total: 0 };
let ready: { asset: Asset; tag: string; file: string } | null = null;
let downloading: Promise<void> | null = null;
let current: Promise<unknown> | null = null;
const cache = () => path.join(app.getPath("userData"), "krysta-update-cache");
async function prefs(): Promise<Prefs> {
  return readKrystaSettings<Prefs>(app.getPath("userData"), "updates", {
    automatic: true,
    notifications: true,
  });
}
let prefQueue: Promise<unknown> = Promise.resolve();
function changePrefs(patch: Partial<Prefs>) {
  const task = prefQueue.then(async () =>
    writeKrystaSettings(app.getPath("userData"), "updates", {
      ...(await prefs()),
      ...patch,
    })
  );
  prefQueue = task.catch(() => {});
  return task;
}
const parse = (v: string) => /^v?(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/.exec(v);
export function newer(tag: string, base: string): boolean | null {
  const a = parse(tag),
    b = parse(base);
  if (!a || !b) return null;
  for (let i = 1; i <= 3; i++) {
    if (Number(a[i]) !== Number(b[i])) return Number(a[i]) > Number(b[i]);
  }
  return (
    (a[4] === undefined ? Infinity : Number(a[4])) >
    (b[4] === undefined ? Infinity : Number(b[4]))
  );
}
function assetFor(d: any): Asset | null {
  if (
    typeof d.tag_name !== "string" ||
    !parse(d.tag_name) ||
    !Array.isArray(d.assets)
  )
    return null;
  const name = "krysta-launcher-" + d.tag_name.replace(/^v/, "") + "-setup.exe";
  const a = d.assets.find((a: any) => a.name === name);
  const url = releasePage + "/download/" + d.tag_name + "/" + name;
  if (
    !a ||
    a.browser_download_url !== url ||
    !Number.isSafeInteger(a.size) ||
    a.size <= 0 ||
    a.size > maxBytes ||
    !/^sha256:[a-f0-9]{64}$/.test(a.digest ?? "")
  )
    return null;
  return { name, url, size: a.size, sha256: a.digest.slice(7) };
}
async function latestKrysta(): Promise<Release | null> {
  const r = await fetch(
    "https://api.github.com/repos/" + repo + "/releases?per_page=100",
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Krysta-Launcher",
      },
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    }
  );
  if (!r.ok) throw Error("GitHub HTTP " + r.status);
  const data = await r.json();
  if (!Array.isArray(data)) throw Error("Invalid release response");
  const beta = /-beta\./.test(app.getVersion());
  let best: Release | null = null;
  for (const d of data) {
    if (
      d.draft ||
      typeof d.tag_name !== "string" ||
      !parse(d.tag_name) ||
      (!beta && (d.prerelease || /-beta\./.test(d.tag_name)))
    )
      continue;
    if (!/^Krysta Launcher\b/i.test(String(d.name))) continue;
    const name =
      "krysta-launcher-" + d.tag_name.replace(/^v/, "") + "-setup.exe";
    if (!Array.isArray(d.assets) || !d.assets.some((a: any) => a.name === name))
      continue;
    if (!best || newer(d.tag_name, best.tag) === true)
      best = {
        tag: d.tag_name,
        body: String(d.body ?? "").slice(0, 30000),
        publishedAt: String(d.published_at ?? ""),
        asset: assetFor(d),
      };
  }
  return best;
}
type SyncStatus = {
  base: string | null;
  upstream: string | null;
  phase: "integrated" | "pending" | "running" | "review" | "failed" | "unknown";
  checkedAt: string;
};
let syncCache: SyncStatus | null = null;
let syncRequest: Promise<SyncStatus> | null = null;
const upstreamVersion = () => {
  const v = import.meta.env.MAIN_VITE_KRYSTA_HYDRA_BASE;
  return typeof v === "string" && /^v?\d+\.\d+\.\d+$/.test(v) ? v : null;
};
async function githubJson(endpoint: string) {
  const r = await fetch("https://api.github.com/repos/" + endpoint, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Krysta-Launcher",
    },
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  if (!r.ok) throw Error("GitHub HTTP " + r.status);
  return r.json();
}
async function syncStatus(force = false): Promise<SyncStatus> {
  if (syncRequest) return syncRequest;
  if (
    !force &&
    syncCache &&
    Date.now() - Date.parse(syncCache.checkedAt) < 15 * 60 * 1000
  )
    return syncCache;
  syncRequest = (async () => {
    const base = upstreamVersion(),
      checkedAt = new Date().toISOString();
    let upstream: string | null = null,
      phase: SyncStatus["phase"] = "unknown";
    try {
      const d = await githubJson("hydralauncher/hydra/releases/latest");
      if (
        typeof d.tag_name === "string" &&
        /^v?\d+\.\d+\.\d+$/.test(d.tag_name)
      )
        upstream = d.tag_name;
      if (base && upstream) {
        if (newer(upstream, base) === false) phase = "integrated";
        else {
          // Run status is informational only; it never authorizes installing upstream binaries.
          phase = "pending";
          try {
            const data = await githubJson(
              repo +
                "/actions/workflows/krysta-upstream-sync.yml/runs?per_page=10"
            );
            const runs = Array.isArray(data.workflow_runs)
              ? data.workflow_runs
              : [];
            // A run from before the upstream release cannot describe this integration.
            const run = runs.find(
              (r: any) => Date.parse(r.created_at) >= Date.parse(d.published_at)
            );
            if (run) {
              if (run.status !== "completed") phase = "running";
              else if (
                run.conclusion === "failure" ||
                run.conclusion === "timed_out"
              )
                phase = "failed";
              else if (run.conclusion === "success") phase = "review";
            }
          } catch {
            /* Upstream version available; workflow status unavailable. */
          }
        }
      }
    } catch {
      /* Keep the update channel independent from Hydra availability. */
    }
    return (syncCache = { base, upstream, phase, checkedAt });
  })().finally(() => {
    syncRequest = null;
  });
  return syncRequest;
}
ipcMain.handle("krysta:updates-sync-status", () => syncStatus());
ipcMain.handle("krysta:updates-sync-refresh", () => syncStatus(true));
function canDownload() {
  return (
    app.isPackaged &&
    process.platform === "win32" &&
    process.arch === "x64" &&
    !process.env.PORTABLE_EXECUTABLE_FILE
  );
}
async function verified(file: string, asset: Asset) {
  try {
    const st = await fs.lstat(file);
    if (!st.isFile() || st.isSymbolicLink() || st.size !== asset.size)
      return false;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest("hex") === asset.sha256;
  } catch {
    return false;
  }
}
async function downloadResponse(url: string, signal: AbortSignal) {
  for (let i = 0; i < 5; i++) {
    const u = new URL(url);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.port ||
      ![
        "github.com",
        "release-assets.githubusercontent.com",
        "objects.githubusercontent.com",
      ].includes(u.hostname)
    )
      throw Error("Unexpected download host");
    const r = await fetch(u, {
      signal,
      redirect: "manual",
      headers: { "User-Agent": "Krysta-Launcher" },
    });
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const loc = r.headers.get("location");
      await r.body?.cancel();
      if (!loc) throw Error("Missing redirect");
      url = new URL(loc, u).href;
      continue;
    }
    return r;
  }
  throw Error("Too many redirects");
}
async function download(release: Release) {
  const asset = release.asset;
  if (!asset || !canDownload()) return;
  await fs.mkdir(cache(), { recursive: true, mode: 0o700 });
  const file = path.join(cache(), asset.name),
    tmp = file + "." + randomUUID() + ".part";
  status = {
    phase: "downloading",
    version: release.tag,
    received: 0,
    total: asset.size,
  };
  ready = null;
  try {
    if (!(await verified(file, asset))) {
      const signal = AbortSignal.timeout(60 * 60 * 1000);
      const response = await downloadResponse(asset.url, signal);
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw Error("Download HTTP " + response.status);
      }
      const reader = response.body.getReader(),
        hash = createHash("sha256");
      let bytes = 0;
      const chunks = async function* () {
        try {
          while (true) {
            const r = await reader.read();
            if (r.done) break;
            yield Buffer.from(r.value);
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      };
      const meter = new Transform({
        transform(chunk: Buffer, _enc, callback) {
          bytes += chunk.length;
          if (bytes > asset.size) {
            callback(Error("Unexpected installer size"));
            return;
          }
          hash.update(chunk);
          status = {
            phase: "downloading",
            version: release.tag,
            received: bytes,
            total: asset.size,
          };
          callback(null, chunk);
        },
      });
      await pipeline(
        Readable.from(chunks()),
        meter,
        createWriteStream(tmp, { flags: "wx", mode: 0o600 }),
        { signal }
      );
      if (bytes !== asset.size || hash.digest("hex") !== asset.sha256)
        throw Error("Installer checksum mismatch");
      await fs.rm(file, { force: true });
      await fs.rename(tmp, file);
    }
    ready = { tag: release.tag, file, asset };
    status = {
      phase: "ready",
      version: release.tag,
      received: asset.size,
      total: asset.size,
    };
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}
function startDownload(release: Release) {
  if (downloading || ready?.tag === release.tag) return;
  if (!release.asset || !canDownload()) {
    status = { phase: "manual", version: release.tag, received: 0, total: 0 };
    return;
  }
  downloading = download(release)
    .catch(() => {
      status = {
        phase: "error",
        version: release.tag,
        received: 0,
        total: 0,
        error:
          "Download or checksum verification failed / Pobieranie lub weryfikacja nie powiodły się",
      };
    })
    .finally(() => {
      downloading = null;
    });
}
async function install() {
  if (
    !ready ||
    downloading ||
    !canDownload() ||
    newer(ready.tag, app.getVersion()) !== true
  )
    throw Error("No verified update ready");
  if (hasTrackedGamesRunning())
    throw Error("Close running games first / Zamknij uruchomione gry");
  const selected = ready;
  if (!(await verified(selected.file, selected.asset))) {
    ready = null;
    status = {
      phase: "error",
      version: selected.tag,
      received: 0,
      total: 0,
      error: "Installer checksum mismatch",
    };
    throw Error("Installer checksum mismatch");
  }
  if (ready !== selected || hasTrackedGamesRunning())
    throw Error("Update state changed");
  const error = await shell.openPath(selected.file);
  if (error) throw Error("Could not open installer");
}
async function check() {
  if (current) return current;
  current = (async () => {
    const version = app.getVersion(),
      krysta = await latestKrysta(),
      p = await prefs();
    const krystaNew = krysta ? newer(krysta.tag, version) : null;
    if (krysta && krystaNew === true) {
      if (p.automatic) startDownload(krysta);
      else if (!downloading && !ready)
        status = {
          phase: "manual",
          version: krysta.tag,
          received: 0,
          total: 0,
        };
      if (
        p.notifications &&
        p.seen !== krysta.tag &&
        Notification.isSupported()
      ) {
        const n = new Notification({
          title: "Krysta Launcher",
          body:
            "Dostępna nowa wersja Krysty / New Krysta release: " + krysta.tag,
        });
        n.on("click", () => void shell.openExternal(releasePage));
        n.show();
        await changePrefs({ seen: krysta.tag });
      }
    } else if (!downloading) {
      ready = null;
      status = { phase: "idle", version: "", received: 0, total: 0 };
    }
    return {
      version,
      hydra: null,
      krysta: krysta
        ? {
            tag: krysta.tag,
            body: krysta.body,
            publishedAt: krysta.publishedAt,
          }
        : null,
      hydraNew: null,
      krystaNew,
      checkedAt: new Date().toISOString(),
    };
  })();
  try {
    return await current;
  } finally {
    current = null;
  }
}
ipcMain.handle("krysta:updates-check", check);
ipcMain.handle("krysta:updates-prefs", prefs);
ipcMain.handle("krysta:updates-status", () => ({ ...status }));
ipcMain.handle("krysta:updates-install", install);
ipcMain.handle(
  "krysta:updates-set",
  async (_e, automatic: unknown, notifications: unknown) => {
    if (typeof automatic !== "boolean" || typeof notifications !== "boolean")
      throw Error("Invalid preferences");
    const p = await changePrefs({ automatic, notifications });
    if (p.automatic) void check().catch(() => {});
    return p;
  }
);
ipcMain.handle("krysta:updates-open", (_e, kind: unknown) => {
  if (kind === "krysta") return shell.openExternal(releasePage);
  if (kind === "sync")
    return shell.openExternal(
      "https://github.com/" +
        repo +
        "/actions/workflows/krysta-upstream-sync.yml"
    );
  throw Error("Invalid destination");
});
void app.whenReady().then(() => {
  const tick = () =>
    void prefs()
      .then((p) => {
        if (p.automatic) {
          void syncStatus().catch(() => {});
          return check();
        }
        return null;
      })
      .catch(() => {});
  const first = setTimeout(tick, 30000),
    timer = setInterval(tick, 60 * 60 * 1000);
  app.once("before-quit", () => {
    clearTimeout(first);
    clearInterval(timer);
  });
});
