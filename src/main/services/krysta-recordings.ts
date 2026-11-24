import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  session,
  shell,
} from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Game, ScreenshotGamepadButton } from "@types";
import {
  isSameScreenshotGamepadCombo,
  normalizeRecordingControllerCombo,
  recordingControllerLabel,
} from "@shared";
import { levelKeys } from "@main/level";
import {
  hasTrackedGamesRunning,
  onTrackedGamesRunningChange,
} from "./game-running-state";
import {
  resolveForegroundGame,
  resolveForegroundWindow,
} from "./screenshots/foreground-game";
import { NativeAddon } from "./native-addon";
import { isWindowsWindowSource } from "./windows-game-window-match";
import capturePage from "@resources/krysta-recording.html?asset";
import captureMuxer from "../../../node_modules/mediabunny/dist/bundles/mediabunny.min.cjs?asset";
import { showRecordingNotice } from "./recording-notice";
import {
  dispatchControllerShortcut,
  setControllerShortcutBinding,
} from "./controller-shortcut-actions";

type RecordingFormat = "webm" | "mp4";
type Settings = {
  enabled: boolean;
  seconds: number;
  audio: boolean;
  preSeconds: number;
  quality: number;
  fps: number;
  limitGb: number;
  hotkey: string;
  hotkeyVersion: 1;
  controllerCombo: ScreenshotGamepadButton[];
  folder?: string;
};
type Clip = {
  id: string;
  game: string;
  achievement: string;
  createdAt: string;
  duration: number;
  audio: boolean;
  size: number;
  format: RecordingFormat;
  thumbnail?: string;
  before?: number;
};
type Result = {
  data: string;
  duration: number;
  audio: boolean;
  thumbnail?: string;
  before: number;
  format?: RecordingFormat;
};
type Active = {
  win: BrowserWindow;
  session: Electron.Session;
  game: Game;
  key: string;
  handle: string;
  pid: number;
  prefs: Settings;
  saving: boolean;
  manual: "recording" | "finishing" | null;
  stopped: boolean;
};
const defaults: Settings = {
  enabled: false,
  seconds: 15,
  audio: false,
  preSeconds: 0,
  quality: 1080,
  fps: 30,
  limitGb: 10,
  hotkey: "F9",
  hotkeyVersion: 1,
  controllerCombo: [],
};
const durations = [5, 10, 15, 30, 45, 60],
  preDurations = [0, 5, 10, 15, 30],
  qualities = [720, 1080, 1440],
  frameRates = [30, 60],
  limits = [1, 5, 10, 20, 50],
  hotkeys = ["", "Control+Shift+F9", "Control+Shift+F8", "Alt+F9", "F9"];
const maxBytes = 96 * 1024 * 1024;
const root = () => path.join(app.getPath("userData"), "recordings");
const settingsPath = () => path.join(root(), "settings.json");
const folder = (s: Settings) => s.folder || root();
const validId = (id: unknown): id is string =>
  typeof id === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
const thumbnail = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 24000 &&
  /^data:image\/jpeg;base64,[a-zA-Z0-9+/=]+$/.test(value);
const isRecordingFormat = (value: unknown): value is RecordingFormat =>
  value === "webm" || value === "mp4";

let muxerScript: Promise<string> | undefined;

async function prepareNvidiaEncoder(win: BrowserWindow): Promise<boolean> {
  try {
    const info = (await app.getGPUInfo("complete")) as {
      gpuDevice?: { vendorId: number; deviceId: number; active: boolean }[];
    };
    const hardwareDevices = info.gpuDevice?.filter(
      ({ vendorId, deviceId }) => vendorId !== 0x1414 || deviceId !== 0x008c
    );
    // Chromium can select another vendor's Media Foundation encoder when
    // multiple hardware vendors are present, even with NVIDIA marked active.
    if (
      !hardwareDevices?.some((device) => device.active) ||
      hardwareDevices.some((device) => device.vendorId !== 0x10de)
    )
      return false;

    muxerScript ??= fs.readFile(captureMuxer, "utf8");
    await win.webContents.executeJavaScript(
      `${await muxerScript}\n;void (globalThis.krystaRecordingMuxer = Mediabunny);`
    );
    return true;
  } catch {
    return false;
  }
}

function normalize(value: unknown, migrateLegacy = false): Settings | null {
  if (!value || typeof value !== "object") return null;
  const { controllerButton, ...raw } = value as Partial<Settings> & {
    controllerButton?: unknown;
  };
  const controllerCombo = normalizeRecordingControllerCombo(
    raw.controllerCombo,
    controllerButton
  );
  if (!controllerCombo) return null;
  const hotkey =
    migrateLegacy &&
    raw.hotkeyVersion === undefined &&
    raw.hotkey === "Control+Shift+F9"
      ? defaults.hotkey
      : (raw.hotkey ?? defaults.hotkey);
  const s = {
    ...defaults,
    ...raw,
    hotkey,
    hotkeyVersion: defaults.hotkeyVersion,
    controllerCombo,
  };
  if (
    typeof s.enabled !== "boolean" ||
    typeof s.audio !== "boolean" ||
    !durations.includes(s.seconds) ||
    !preDurations.includes(s.preSeconds) ||
    !qualities.includes(s.quality) ||
    !frameRates.includes(s.fps) ||
    !limits.includes(s.limitGb) ||
    !hotkeys.includes(s.hotkey)
  )
    return null;
  return {
    ...s,
    folder:
      typeof s.folder === "string" && path.isAbsolute(s.folder)
        ? s.folder
        : undefined,
  };
}
let preferences: Settings | null = null,
  loading: Promise<Settings> | null = null;
async function settings(): Promise<Settings> {
  if (preferences) return preferences;
  if (!loading)
    loading = fs
      .readFile(settingsPath(), "utf8")
      .then((s) => normalize(JSON.parse(s), true) ?? { ...defaults })
      .catch(() => ({ ...defaults }))
      .then((s) => (preferences = s))
      .finally(() => {
        loading = null;
      });
  return loading;
}
let settingsQueue: Promise<unknown> = Promise.resolve();
let current: Active | null = null,
  opening: Promise<Active | null> | null = null,
  epoch = 0,
  quitting = false,
  checking = false,
  lastError = "",
  registered = "",
  shortcutError = false,
  pausedWindow = "",
  retryAt = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let controllerTimer: ReturnType<typeof setInterval> | undefined;
let controllerCombo: Settings["controllerCombo"] = [];
let storageQueue: Promise<unknown> = Promise.resolve();
let spaceCache: {
  dir: string;
  limit: number;
  checked: number;
  ok: boolean;
} | null = null;
function serializeStorage<T>(operation: () => Promise<T>): Promise<T> {
  const task = storageQueue.then(operation, operation);
  storageQueue = task.catch(() => {});
  return task;
}
async function enoughSpace(s: Settings, bytes: number, cache = false) {
  const dir = folder(s);
  if (
    cache &&
    spaceCache?.dir === dir &&
    spaceCache.limit === s.limitGb &&
    Date.now() - spaceCache.checked < 10000
  )
    return spaceCache.ok;
  await fs.mkdir(dir, { recursive: true });
  const used = (await list(dir)).reduce((n, c) => n + c.size, 0);
  const disk = await fs.statfs(dir);
  const ok =
    used + bytes <= s.limitGb * 1024 ** 3 &&
    disk.bavail * disk.bsize >= bytes + 32 * 1024 ** 2;
  if (cache) spaceCache = { dir, limit: s.limitGb, checked: Date.now(), ok };
  return ok;
}

const signature = (handle: string, pid: number) => handle + ":" + pid;
function dispose(a: Active) {
  if (current === a) current = null;
  a.stopped = true;
  if (!a.win.isDestroyed()) a.win.destroy();
  a.session.setDisplayMediaRequestHandler(null);
  a.session.setPermissionCheckHandler(null);
  a.session.setPermissionRequestHandler(null);
}
function end(a: Active) {
  if (a.stopped) return;
  if (a.manual) {
    if (a.manual === "recording") void finishManualRecording(a);
    return;
  }
  a.stopped = true;
  if (a.saving && !a.win.isDestroyed())
    void a.win.webContents
      .executeJavaScript("globalThis.krystaStop?.()")
      .catch(() => dispose(a));
  else dispose(a);
}
function cancel(pause = false) {
  epoch++;
  if (current) {
    if (pause) pausedWindow = signature(current.handle, current.pid);
    end(current);
  }
}
async function stopRecording() {
  if (current?.manual) {
    if (current.manual === "recording") await finishManualRecording(current);
    return;
  }
  cancel(true);
}
async function saveSettings(next: Settings) {
  const job = settingsQueue.then(async () => {
    await fs.mkdir(root(), { recursive: true });
    const tmp = settingsPath() + "." + randomUUID() + ".tmp";
    try {
      await fs.writeFile(tmp, JSON.stringify(next), {
        flag: "wx",
        mode: 0o600,
      });
      await fs.rename(tmp, settingsPath());
    } finally {
      await fs.rm(tmp, { force: true });
    }
    preferences = next;
    pausedWindow = "";
    retryAt = 0;
    spaceCache = null;
    cancel();
    applyHotkey(next);
    syncRecordingMonitor();
  });
  settingsQueue = job.catch(() => {});
  await job;
}
function applyHotkey(s: Settings) {
  if (process.platform !== "win32" || !app.isReady()) return;
  const desired = s.enabled ? s.hotkey : "";
  if (registered === desired && !shortcutError) return;
  if (registered) globalShortcut.unregister(registered);
  registered = "";
  shortcutError = false;
  if (desired) {
    try {
      if (
        globalShortcut.register(desired, () => {
          void toggleManualRecording();
        })
      )
        registered = desired;
      else shortcutError = true;
    } catch {
      shortcutError = true;
    }
  }
}
export async function setRecordingSettings(value: unknown) {
  const s = normalize(value);
  if (!s) throw Error("Invalid recording settings");
  if (s.enabled && process.platform !== "win32") throw Error("Windows only");
  const old = await settings();
  await saveSettings({ ...s, folder: old.folder });
}
export async function chooseRecordingFolder(reset = false) {
  const old = await settings();
  if (reset) {
    await saveSettings({ ...old, folder: undefined });
    return;
  }
  const result = await dialog.showOpenDialog({
    title: "Krysta recordings",
    defaultPath: folder(old),
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return;
  const chosen = path.resolve(result.filePaths[0]);
  await saveSettings({ ...old, folder: chosen });
}
async function safeClip(id: unknown, dir: string, format?: RecordingFormat) {
  if (!validId(id)) throw Error("Invalid recording id");
  let file = path.join(dir, `${id}.${format ?? "webm"}`);
  const stat = await fs.lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (format || error.code !== "ENOENT") throw error;
    file = path.join(dir, `${id}.mp4`);
    return fs.lstat(file);
  });
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes)
    throw Error("Invalid recording");
  return { file, stat };
}
async function list(dir: string): Promise<Clip[]> {
  const entries = await fs
      .readdir(dir)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [] as string[];
        throw error;
      }),
    clips: Clip[] = [];
  for (const name of entries.filter(
    (n) => n.endsWith(".json") && validId(n.slice(0, -5))
  )) {
    try {
      const id = name.slice(0, -5),
        info = path.join(dir, name),
        st = await fs.lstat(info);
      if (!st.isFile() || st.isSymbolicLink() || st.size > 65536) continue;
      const c = JSON.parse(await fs.readFile(info, "utf8")) as Clip;
      const format = c.format ?? "webm";
      if (
        c.id !== id ||
        !isRecordingFormat(format) ||
        typeof c.game !== "string" ||
        typeof c.achievement !== "string" ||
        !Number.isFinite(Date.parse(c.createdAt)) ||
        !Number.isFinite(c.duration) ||
        c.duration <= 0 ||
        typeof c.audio !== "boolean"
      )
        continue;
      const { stat } = await safeClip(id, dir, format);
      clips.push({
        id,
        game: c.game,
        achievement: c.achievement,
        createdAt: c.createdAt,
        duration: c.duration,
        audio: c.audio,
        size: stat.size,
        format,
        before:
          typeof c.before === "number" && Number.isFinite(c.before)
            ? c.before
            : undefined,
        thumbnail: thumbnail(c.thumbnail) ? c.thumbnail : undefined,
      });
    } catch {
      /* incomplete recording */
    }
  }
  return clips.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
async function persist(
  a: Active,
  result: Result,
  names: string[],
  manual = false
) {
  if (
    !result ||
    typeof result.data !== "string" ||
    result.data.length > Math.ceil(maxBytes / 3) * 4 + 4 ||
    !Number.isFinite(result.duration) ||
    result.duration < 1 ||
    result.duration >
      (manual ? 60 * 60 : a.prefs.seconds + a.prefs.preSeconds + 4)
  )
    throw Error("Recording incomplete or too short");
  const bytes = Buffer.from(result.data, "base64");
  const format = result.format ?? "webm";
  if (
    !bytes.length ||
    bytes.length > maxBytes ||
    !isRecordingFormat(format) ||
    (format === "webm"
      ? bytes.subarray(0, 4).toString("hex") !== "1a45dfa3"
      : bytes.length < 16 ||
        bytes.subarray(4, 8).toString("ascii") !== "ftyp" ||
        bytes.readUInt32BE(0) < 16 ||
        bytes.readUInt32BE(0) > bytes.length)
  )
    throw Error("Invalid recording file");
  const dir = folder(a.prefs);
  const id = randomUUID();
  const clip: Clip = {
    id,
    game: a.game.title.slice(0, 300),
    achievement: names.join(" · ").slice(0, 500),
    createdAt: new Date(Date.now() - result.duration * 1000).toISOString(),
    duration: Math.round(result.duration * 10) / 10,
    before:
      Math.round(
        Math.max(0, Math.min(result.before, a.prefs.preSeconds)) * 10
      ) / 10,
    audio: result.audio === true,
    size: bytes.length,
    format,
    thumbnail: thumbnail(result.thumbnail) ? result.thumbnail : undefined,
  };
  await serializeStorage(async () => {
    if (!(await enoughSpace(a.prefs, bytes.length)))
      throw Error(
        "Limit nagrań lub brak miejsca / Recording limit or insufficient disk space"
      );
    await writeClip(dir, clip, bytes);
  });
}
async function writeClip(dir: string, clip: Clip, bytes: Uint8Array) {
  const file = path.join(dir, `${clip.id}.${clip.format}`),
    info = path.join(dir, clip.id + ".json");
  let wroteVideo = false,
    wroteInfo = false;
  try {
    const video = await fs.open(file, "wx");
    wroteVideo = true;
    try {
      await video.writeFile(bytes);
    } finally {
      await video.close();
    }
    const metadata = await fs.open(info, "wx", 0o600);
    wroteInfo = true;
    try {
      await metadata.writeFile(JSON.stringify(clip));
    } finally {
      await metadata.close();
    }
  } catch (e) {
    if (wroteVideo) await fs.rm(file, { force: true }).catch(() => {});
    if (wroteInfo) await fs.rm(info, { force: true }).catch(() => {});
    throw e;
  } finally {
    spaceCache = null;
  }
}
export async function saveTrimmedRecording(
  id: unknown,
  start: unknown,
  end: unknown,
  data: unknown,
  duration: unknown,
  audio: unknown
) {
  if (
    typeof start !== "number" ||
    typeof end !== "number" ||
    typeof duration !== "number" ||
    ![start, end, duration].every(Number.isFinite) ||
    start < 0 ||
    end - start < 1 ||
    duration < 1 ||
    Math.abs(duration - (end - start)) > 1.5 ||
    typeof audio !== "boolean"
  )
    throw Error("Invalid trim range");
  if (
    !(data instanceof Uint8Array) ||
    data.byteLength > maxBytes ||
    data.byteLength < 4 ||
    Buffer.from(data.subarray(0, 4)).toString("hex") !== "1a45dfa3"
  )
    throw Error("Invalid video data");
  const prefs = await settings(),
    dir = folder(prefs);
  await serializeStorage(async () => {
    await safeClip(id, dir);
    const original = (await list(dir)).find((c) => c.id === id);
    if (!original || end > original.duration + 0.1 || original.audio !== audio)
      throw Error("Original clip or audio unavailable");
    if (!(await enoughSpace(prefs, data.byteLength)))
      throw Error(
        "Limit nagrań lub brak miejsca / Recording limit or insufficient disk space"
      );
    const clip: Clip = {
      id: randomUUID(),
      game: original.game,
      achievement: original.achievement + " · Trim",
      createdAt: new Date(
        Date.parse(original.createdAt) + start * 1000
      ).toISOString(),
      duration: Math.round(duration * 10) / 10,
      audio,
      size: data.byteLength,
      format: "webm",
      before:
        original.before === undefined
          ? undefined
          : Math.max(0, Math.min(duration, original.before - start)),
    };
    await writeClip(dir, clip, data);
  });
}

async function sameForeground(a: Active) {
  const f = await resolveForegroundWindow();
  return !!f && f.processId === a.pid && f.windowHandle === a.handle;
}
async function openCapture(
  prefs: Settings,
  expected: string | null,
  generation: number
): Promise<Active | null> {
  const match = await resolveForegroundGame("deeplink");
  if (
    match.status !== "resolved" ||
    !match.game ||
    !match.foreground?.windowHandle ||
    match.foreground.processId == null ||
    (expected && match.target.gameKey !== expected)
  )
    return null;
  const handle = match.foreground.windowHandle,
    pid = match.foreground.processId;
  if (
    pausedWindow === signature(handle, pid) ||
    generation !== epoch ||
    quitting
  )
    return null;
  if (!(await enoughSpace(prefs, 8 * 1024 ** 2, true))) {
    lastError =
      "Limit nagrań lub brak miejsca / Recording limit or insufficient disk space";
    return null;
  }
  const sources = await desktopCapturer.getSources({
    types: ["window"],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false,
  });
  const source = sources.find((s) => isWindowsWindowSource(s.id, handle));
  const foreground = await resolveForegroundWindow();
  if (
    !foreground ||
    foreground.processId !== pid ||
    foreground.windowHandle !== handle ||
    generation !== epoch ||
    quitting
  )
    return null;
  if (!source)
    throw Error(
      "Okno gry jest niedostępne dla nagrywania. Spróbuj trybu bez ramek. / The game window is unavailable for capture. Try borderless mode."
    );
  const captureSession = session.fromPartition("krysta-recordings-worker");
  const win = new BrowserWindow({
    show: false,
    focusable: false,
    skipTaskbar: true,
    webPreferences: {
      session: captureSession,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  const a: Active = {
    win,
    session: captureSession,
    game: match.game,
    key: match.target.gameKey,
    handle,
    pid,
    prefs,
    saving: false,
    manual: null,
    stopped: false,
  };
  current = a;
  const allowed = () =>
    current === a && !a.stopped && !win.isDestroyed() && generation === epoch;
  captureSession.setPermissionRequestHandler(
    (contents, permission, callback, details) => {
      // Electron 41 reports display capture as "media" with no camera/mic types.
      const legacyDisplayCapture =
        permission === "media" &&
        "mediaTypes" in details &&
        Array.isArray(details.mediaTypes) &&
        details.mediaTypes.length === 0;
      callback(
        allowed() &&
          contents === win.webContents &&
          details.isMainFrame &&
          (permission === "display-capture" || legacyDisplayCapture)
      );
    }
  );
  captureSession.setPermissionCheckHandler(
    (contents, permission) =>
      allowed() &&
      contents === win.webContents &&
      String(permission) === "display-capture"
  );
  captureSession.setDisplayMediaRequestHandler((request, callback) => {
    if (
      !allowed() ||
      request.frame !== win.webContents.mainFrame ||
      !request.videoRequested
    ) {
      callback({});
      return;
    }
    void sameForeground(a)
      .then((ok) => {
        if (!ok || !allowed()) callback({});
        else
          callback(
            prefs.audio && request.audioRequested
              ? { video: source, audio: "loopback" }
              : { video: source }
          );
      })
      .catch(() => callback({}));
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.once("render-process-gone", () => {
    if (current === a) {
      lastError = "Recording worker exited";
      dispose(a);
    }
  });
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await win.loadFile(capturePage);
    if (!allowed() || !(await sameForeground(a))) {
      dispose(a);
      return null;
    }
    await Promise.race([
      prepareNvidiaEncoder(win).then((preferNvidia) =>
        win.webContents.executeJavaScript(
          "globalThis.krystaStart(" +
            JSON.stringify({ ...prefs, maxBytes, preferNvidia }) +
            ")",
          true
        )
      ),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(
          () => reject(Error("Capture startup timed out")),
          15000
        );
      }),
    ]);
    if (!allowed() || !(await sameForeground(a))) {
      dispose(a);
      return null;
    }
    lastError = "";
    return a;
  } catch (e) {
    if (current === a) dispose(a);
    throw e;
  } finally {
    if (deadline) clearTimeout(deadline);
  }
}
async function ensure(expected: string | null = null): Promise<Active | null> {
  if (
    current &&
    !current.stopped &&
    !opening &&
    (!expected || current.key === expected)
  )
    return current;
  if (opening) return opening;
  if (current) return null;
  const s = await settings();
  if (!s.enabled || quitting || process.platform !== "win32") return null;
  if (opening) return opening;
  if (current) return null;
  const generation = epoch;
  opening = openCapture(s, expected, generation)
    .catch((error) => {
      if (generation === epoch) {
        lastError = String(error).slice(0, 500);
        retryAt = Date.now() + 5000;
      }
      return null;
    })
    .finally(() => {
      opening = null;
    });
  return opening;
}
// A manual session uses the same recorder as achievement clips but has no
// preset duration. The second hotkey ends and persists the active session.
let manualTransition: Promise<void> | null = null;
async function startManualRecording(source: "keyboard" | "controller") {
  lastError = "";
  let a: Active | null = null;
  try {
    const prefs = await settings();
    if (!prefs.enabled)
      throw Error(
        "Włącz nagrywanie w ustawieniach / Enable recording in settings"
      );
    if (triggering || current?.saving)
      throw Error(
        "Zaczekaj na zapis bieżącego klipu / Wait for the current clip"
      );

    // An explicit hotkey press can restart capture after stopping the replay buffer.
    pausedWindow = "";
    a = await ensure();
    if (!a || a.stopped || !(await sameForeground(a))) {
      if (source === "controller" && !lastError) return;
      throw Error(
        lastError ||
          "Nie rozpoznano aktywnego okna gry / Active game window not found"
      );
    }
    if (!(await enoughSpace(a.prefs, 8 * 1024 ** 2, true)))
      throw Error("Limit nagrań lub brak miejsca / Recording storage limit");

    await a.win.webContents.executeJavaScript(
      "globalThis.krystaManualStart()",
      true
    );
    if (a.stopped || current !== a)
      throw Error(
        "Aktywne okno gry zmieniło się / The active game window changed"
      );
    a.manual = "recording";
    a.saving = true;
    const keyboardHint = a.prefs.hotkey.replace("Control", "Ctrl");
    void showRecordingNotice(
      "started",
      source === "controller"
        ? recordingControllerLabel(a.prefs.controllerCombo)
        : keyboardHint
    );
  } catch (error) {
    lastError = (error instanceof Error ? error.message : String(error)).slice(
      0,
      500
    );
    if (a && current === a) end(a);
    void showRecordingNotice("failed");
  }
}
async function finishManualRecording(a: Active) {
  if (a.manual !== "recording" || a.stopped) return;
  a.manual = "finishing";
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      a.win.webContents.executeJavaScript(
        "globalThis.krystaManualFinish()",
        true
      ) as Promise<Result>,
      new Promise<never>((_, reject) => {
        deadline = setTimeout(
          () => reject(Error("Manual recording finalization timed out")),
          20000
        );
      }),
    ]);
    await persist(a, result, ["Manual recording"], true);
    lastError = "";
    void showRecordingNotice("saved");
  } catch (e) {
    lastError = String(e).slice(0, 500);
    void showRecordingNotice("failed");
  } finally {
    if (deadline) clearTimeout(deadline);
    a.saving = false;
    if (current === a) dispose(a);
  }
}
function toggleManualRecording(source: "keyboard" | "controller" = "keyboard") {
  // Serialize rapid double-presses so they cannot start two parallel captures.
  if (manualTransition) return manualTransition;
  manualTransition = (async () => {
    if (current?.manual === "recording") await finishManualRecording(current);
    else if (!current?.manual) await startManualRecording(source);
  })().finally(() => {
    manualTransition = null;
  });
  return manualTransition;
}
let triggering = false;
let pendingNames: string[] | null = null;
let pendingKey: string | null = null;
async function trigger(expected: string | null, names: string[]) {
  if (quitting || process.platform !== "win32" || !app.isReady()) return;
  if (triggering) {
    if (expected && expected === pendingKey && pendingNames)
      for (const name of names)
        if (!pendingNames.includes(name) && pendingNames.length < 20)
          pendingNames.push(name);
    return;
  }
  triggering = true;
  pendingNames = [...names];
  pendingKey = expected;
  let a: Active | null = null,
    deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const s = await settings();
    if (!s.enabled) return;
    a = await ensure(expected);
    if (
      !a ||
      a.stopped ||
      a.saving ||
      (expected && a.key !== expected) ||
      !(await sameForeground(a))
    )
      return;
    if (!(await enoughSpace(a.prefs, 8 * 1024 ** 2, true)))
      throw Error("Recording storage limit or insufficient space");
    if (a.stopped || a.manual || !(await sameForeground(a))) return;
    a.saving = true;
    pendingKey = a.key;
    const result = await Promise.race([
      a.win.webContents.executeJavaScript(
        "globalThis.krystaSave()",
        true
      ) as Promise<Result>,
      new Promise<never>((_, reject) => {
        deadline = setTimeout(
          () => reject(Error("Recording timed out")),
          (a!.prefs.seconds + 20) * 1000
        );
      }),
    ]);
    await persist(a, result, pendingNames ?? names);
    lastError = "";
  } catch (e) {
    lastError = String(e).slice(0, 500);
    if (a && current === a) end(a);
  } finally {
    if (deadline) clearTimeout(deadline);
    if (a) {
      a.saving = false;
      if (a.stopped || a.prefs.preSeconds === 0) {
        if (current === a) dispose(a);
      }
    }
    triggering = false;
    pendingNames = null;
    pendingKey = null;
  }
}
export async function isAchievementRecordingEnabled() {
  return process.platform === "win32" && (await settings()).enabled;
}
export async function recordAchievementClip(
  game: Game,
  achievementNames: string[]
) {
  if (achievementNames.length)
    await trigger(levelKeys.game(game.shop, game.objectId), achievementNames);
}
async function reconcile() {
  if (checking || quitting || process.platform !== "win32") return;
  checking = true;
  try {
    const s = await settings();
    if (!s.enabled || !hasTrackedGamesRunning()) {
      if (current) end(current);
      if (!hasTrackedGamesRunning()) pausedWindow = "";
      return;
    }
    if (s.preSeconds === 0 && !current && !opening && !pausedWindow) return;

    const f = await resolveForegroundWindow(),
      sig =
        f?.windowHandle && f.processId != null
          ? signature(f.windowHandle, f.processId)
          : "";
    if (pausedWindow && sig !== pausedWindow) pausedWindow = "";
    if (current && (!sig || signature(current.handle, current.pid) !== sig)) {
      end(current);
      return;
    }
    if (
      !current &&
      !opening &&
      sig &&
      sig !== pausedWindow &&
      s.preSeconds > 0 &&
      Date.now() >= retryAt
    ) {
      const a = await ensure();
      if (!a) retryAt = Date.now() + 2000;
    }
  } catch (e) {
    if (current) end(current);
    lastError = String(e).slice(0, 500);
  } finally {
    checking = false;
  }
}
export async function recordingState() {
  const s = await settings(),
    dir = folder(s),
    clips = await list(dir);
  return {
    supported: process.platform === "win32",
    settings: s,
    folder: dir,
    recording: !!current?.saving,
    manualRecording: !!current?.manual,
    buffering:
      !!current && !current.stopped && !current.saving && s.preSeconds > 0,
    shortcutError,
    lastError,
    usedBytes: clips.reduce((n, c) => n + c.size, 0),
    clips,
  };
}
export async function openRecording(id: unknown) {
  const { file } = await safeClip(id, folder(await settings()));
  const error = await shell.openPath(file);
  if (error) throw Error(error);
}
export async function readRecording(id: unknown) {
  const { file } = await safeClip(id, folder(await settings()));
  return new Uint8Array(await fs.readFile(file));
}
export async function deleteRecording(id: unknown) {
  const dir = folder(await settings()),
    { file } = await safeClip(id, dir);
  await serializeStorage(async () => {
    await fs.unlink(file);
    await fs.rm(path.join(dir, String(id) + ".json"), { force: true });
    spaceCache = null;
  });
}
export async function openRecordingsFolder() {
  const dir = folder(await settings());
  await fs.mkdir(dir, { recursive: true });
  const error = await shell.openPath(dir);
  if (error) throw Error(error);
}
export { stopRecording, toggleManualRecording };

function syncRecordingController(combo: Settings["controllerCombo"]) {
  if (isSameScreenshotGamepadCombo(combo, controllerCombo)) return;
  if (controllerTimer) clearInterval(controllerTimer);
  controllerTimer = undefined;
  controllerCombo = combo;
  setControllerShortcutBinding("recording", combo);
  if (!combo.length) return;

  let wasPressed: boolean | null = null;
  controllerTimer = setInterval(() => {
    const pressed = NativeAddon.getWindowsGamepadComboPressed(combo);
    const justPressed = wasPressed === false && pressed === true;
    wasPressed = pressed;
    if (justPressed) {
      dispatchControllerShortcut("recording", () => {
        void toggleManualRecording("controller");
        return true;
      });
    }
  }, 24);
  controllerTimer.unref();
}

function syncRecordingMonitor() {
  if (process.platform !== "win32" || !app.isReady() || quitting) return;
  const running = hasTrackedGamesRunning();
  const active = preferences?.enabled && running ? preferences : null;
  syncRecordingController(active?.controllerCombo ?? []);
  if (active) {
    if (!timer) {
      timer = setInterval(() => void reconcile(), 500);
      timer.unref?.();
    }
    void reconcile();
    return;
  }

  if (timer) clearInterval(timer);
  timer = undefined;
  if (!running) {
    pausedWindow = "";
    if (current || opening) cancel();
  }
}

const unsubscribe =
  process.platform === "win32"
    ? onTrackedGamesRunningChange(syncRecordingMonitor)
    : undefined;
void app
  .whenReady()
  .then(async () => {
    if (process.platform !== "win32" || quitting) return;
    applyHotkey(await settings());
    syncRecordingMonitor();
  })
  .catch(() => {});
app.on("before-quit", () => {
  quitting = true;
  unsubscribe?.();
  syncRecordingController([]);
  epoch++;
  if (timer) clearInterval(timer);
  if (registered) globalShortcut.unregister(registered);
  if (current) dispose(current);
});
