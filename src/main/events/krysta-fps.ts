import {
  readKrystaSettings,
  writeKrystaSettings,
} from "@main/services/krysta-settings-recovery";
import {
  ipcMain,
  app,
  BrowserWindow,
  screen,
  dialog,
  globalShortcut,
} from "electron";
import { promises as fs } from "node:fs";
import { join, basename } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { resolveForegroundGame } from "@main/services/screenshots/foreground-game";
import { NativeAddon } from "@main/services/native-addon";
import {
  hasTrackedGamesRunning,
  isTrackedGameKeyRunning,
  onTrackedGamesRunningChange,
} from "@main/services/game-running-state";
import { PresentMonFps } from "@main/services/presentmon-fps";

type Position = "tl" | "tr" | "bl" | "br";
type Preference = {
  enabled: boolean;
  tool?: string;
  position?: Position;
  hotkey?: string;
};
function normalizePosition(value: unknown): Position {
  return value === "tr" || value === "bl" || value === "br" ? value : "tl";
}
function placement(bounds: Electron.Rectangle, position: Position) {
  return {
    x:
      bounds.x +
      (position.endsWith("r") ? Math.max(0, bounds.width - 116) : 16),
    y:
      bounds.y +
      (position.startsWith("b") ? Math.max(0, bounds.height - 42) : 16),
  };
}

type GameWindow = { windowHandle: string; processId: number };
type CaptureTarget = { key: string; processId: number; tool: string };

function overlayPosition({ windowHandle }: GameWindow, position: Position) {
  const client = NativeAddon.getWindowsWindowBounds(windowHandle)?.client;
  if (!client || client.right <= client.left || client.bottom <= client.top) {
    return null;
  }
  const window = screen.screenToDipRect(null, {
    x: client.left,
    y: client.top,
    width: client.right - client.left,
    height: client.bottom - client.top,
  });
  const display = screen.getDisplayMatching(window).bounds;
  const x = Math.max(window.x, display.x);
  const y = Math.max(window.y, display.y);
  const right = Math.min(window.x + window.width, display.x + display.width);
  const bottom = Math.min(window.y + window.height, display.y + display.height);
  if (right <= x || bottom <= y) return null;
  return placement({ x, y, width: right - x, height: bottom - y }, position);
}
async function readPreference(): Promise<Preference> {
  return readKrystaSettings<Preference>(app.getPath("userData"), "fps");
}
async function savePreference(value: Preference) {
  await writeKrystaSettings(app.getPath("userData"), "fps", value);
}
async function findTool(p: Preference) {
  for (const path of [
    p.tool,
    join(process.resourcesPath, "PresentMon.exe"),
    !app.isPackaged
      ? join(app.getAppPath(), ".cache", "presentmon", "PresentMon.exe")
      : undefined,
    join(app.getPath("userData"), "PresentMon.exe"),
  ]) {
    if (
      path &&
      (await fs
        .stat(path)
        .then((s) => s.isFile())
        .catch(() => false))
    )
      return path;
  }
  return null;
}
let overlay: BrowserWindow | null = null,
  child: ChildProcess | null = null,
  timer: ReturnType<typeof setInterval> | null = null,
  activeTarget: CaptureTarget | null = null,
  lastOverlayValue = "FPS: --",
  revision = 0,
  status = "idle";
let hidden = false,
  registered = "",
  shortcutError = false,
  lastError = "",
  poll: ReturnType<typeof setInterval> | undefined;
let reconciling = false,
  refreshPending = false,
  quitting = false;
let failedCapture: { target: CaptureTarget; time: number } | null = null;
let ignoredWindow: { window: GameWindow; time: number } | null = null;

const isSameWindow = (
  current: GameWindow | null | undefined,
  window: GameWindow
) =>
  current?.processId === window.processId &&
  current.windowHandle === window.windowHandle;

const sameCapture = (running: CaptureTarget | null, next: CaptureTarget) =>
  running?.key === next.key &&
  running?.processId === next.processId &&
  running?.tool === next.tool;

const defaultHotkey = "Control+Shift+F10";
function registerHotkey(value: string) {
  if (registered === value) return true;
  if (!value) {
    if (registered) globalShortcut.unregister(registered);
    registered = "";
    return true;
  }
  try {
    if (
      !globalShortcut.register(value, () => {
        hidden = !hidden;
        if (hidden) overlay?.hide();
        refresh();
      })
    )
      return false;
    if (registered) globalShortcut.unregister(registered);
    registered = value;
    return true;
  } catch {
    return false;
  }
}
function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (child) {
    const old = child;
    child = null;
    old.kill();
  }
  if (overlay) {
    const old = overlay;
    overlay = null;
    if (!old.isDestroyed()) old.destroy();
  }
  activeTarget = null;
  lastOverlayValue = "FPS: --";
}
function show(value: string) {
  const window = overlay;
  if (value === lastOverlayValue || !window || window.isDestroyed()) return;
  const contents = window.webContents;
  if (contents.isDestroyed()) return;
  lastOverlayValue = value;
  void contents
    .executeJavaScript(
      "document.getElementById('fps').textContent=" + JSON.stringify(value)
    )
    .catch(() => {
      if (overlay === window && lastOverlayValue === value)
        lastOverlayValue = "";
    });
}
async function reconcile() {
  const generation = ++revision;
  const p = await readPreference();
  if (generation !== revision) return;
  shortcutError = !registerHotkey(p.enabled ? (p.hotkey ?? defaultHotkey) : "");
  if (!p.enabled) {
    stop();
    status = "disabled";
    return;
  }
  if (hidden) {
    stop();
    status = "hidden";
    return;
  }
  if (!hasTrackedGamesRunning()) {
    stop();
    status = "waiting-game";
    return;
  }

  if (activeTarget && !isTrackedGameKeyRunning(activeTarget.key)) stop();
  const tool = await findTool(p);
  if (generation !== revision) return;
  if (!tool) {
    stop();
    status = "missing-tool";
    return;
  }

  let foreground = NativeAddon.getWindowsForegroundWindow();
  let key =
    activeTarget?.processId === foreground?.processId
      ? activeTarget?.key
      : undefined;
  if (!key) {
    overlay?.hide();
    if (
      ignoredWindow &&
      isSameWindow(foreground, ignoredWindow.window) &&
      Date.now() - ignoredWindow.time < 3000
    )
      return;
    const resolved = await resolveForegroundGame("deeplink");
    if (generation !== revision || hidden) return;
    if (
      resolved.status === "resolved" &&
      resolved.foreground?.windowHandle &&
      resolved.foreground.processId
    ) {
      const { windowHandle, processId } = resolved.foreground;
      const current = NativeAddon.getWindowsForegroundWindow();
      if (
        current === undefined ||
        isSameWindow(current, { windowHandle, processId })
      ) {
        foreground = { windowHandle, processId };
        key = resolved.target.gameKey;
      }
    } else if (foreground) {
      ignoredWindow = { window: foreground, time: Date.now() };
    }
  }

  const point =
    key &&
    foreground &&
    overlayPosition(foreground, normalizePosition(p.position));
  if (!point || !key || !foreground) {
    overlay?.hide();
    if (!child && status !== "capture-error") status = "waiting-game";
    return;
  }
  const target = { key, processId: foreground.processId, tool };
  if (
    sameCapture(activeTarget, target) &&
    child &&
    overlay &&
    !overlay.isDestroyed()
  ) {
    const [x, y] = overlay.getPosition();
    if (x !== point.x || y !== point.y) overlay.setPosition(point.x, point.y);
    if (!overlay.isVisible()) overlay.showInactive();
    return;
  }
  if (
    failedCapture &&
    sameCapture(failedCapture.target, target) &&
    Date.now() - failedCapture.time < 3000
  )
    return;
  failedCapture = null;
  stop();
  activeTarget = target;
  status = "starting";
  lastError = "";
  const w = new BrowserWindow({
    ...point,
    width: 100,
    height: 26,
    transparent: true,
    frame: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    resizable: false,
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  overlay = w;
  w.setIgnoreMouseEvents(true);
  w.setAlwaysOnTop(true, "screen-saver");
  const html =
    '<html><body style="margin:0;background:transparent"><div id="fps" style="display:inline-block;color:#fff;background:rgba(16,18,22,.90);border:1px solid rgba(255,255,255,.3);border-radius:5px;padding:4px 8px;font:bold 13px Arial,sans-serif">FPS: --</div></body></html>';
  await w.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  if (generation !== revision || overlay !== w || w.isDestroyed()) {
    if (overlay === w) stop();
    return;
  }
  const current = NativeAddon.getWindowsForegroundWindow();
  if (!hidden && (current === undefined || isSameWindow(current, foreground))) {
    w.showInactive();
  }
  const proc = spawn(
    tool,
    [
      "--process_id",
      String(target.processId),
      "--output_stdout",
      "--no_console_stats",
      "--v1_metrics",
      "--no_track_display",
      "--session_name",
      "KrystaFPS",
      "--stop_existing_session",
      "--terminate_on_proc_exit",
    ],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
  );
  child = proc;
  status = "waiting-frames";
  const frames = new PresentMonFps(target.processId);
  const reader = createInterface({ input: proc.stdout! });
  reader.on("line", (line) => frames.addLine(line));
  proc.stderr?.on("data", (chunk) => {
    if (child !== proc) return;
    lastError = (lastError + String(chunk)).slice(-2000);
  });
  timer = setInterval(() => {
    const fps = frames.takeFps();
    status = fps === null ? "waiting-frames" : "measuring";
    show(fps === null ? "FPS: --" : `FPS: ${fps}`);
  }, 1000);
  const ended = () => {
    if (child === proc) {
      stop();
      status = "capture-error";
      failedCapture = { target, time: Date.now() };
      if (!lastError) lastError = "PresentMon stopped before FPS data arrived";
    }
  };
  proc.once("error", (e) => {
    if (child === proc) lastError = String(e);
    ended();
  });
  proc.once("close", ended);
}
function refresh() {
  if (process.platform !== "win32" || !app.isReady() || quitting) return;
  if (reconciling) {
    refreshPending = true;
    return;
  }
  reconciling = true;
  void reconcile()
    .catch((e) => {
      stop();
      status = "capture-error";
      lastError = String(e);
    })
    .finally(() => {
      reconciling = false;
      if (refreshPending) {
        refreshPending = false;
        refresh();
      }
    });
}
ipcMain.handle(
  "krysta:fps-preference",
  async () => (await readPreference()).enabled === true
);
ipcMain.handle(
  "krysta:fps-set-preference",
  async (_event, enabled: unknown) => {
    if (typeof enabled !== "boolean" || process.platform !== "win32")
      throw new Error("Invalid FPS preference");
    await savePreference({ ...(await readPreference()), enabled });
    hidden = false;
    refresh();
    return enabled;
  }
);
ipcMain.handle("krysta:fps-position", async () =>
  normalizePosition((await readPreference()).position)
);
ipcMain.handle("krysta:fps-set-position", async (_event, position: unknown) => {
  if (
    position !== "tl" &&
    position !== "tr" &&
    position !== "bl" &&
    position !== "br"
  )
    throw new Error("Invalid FPS position");
  await savePreference({ ...(await readPreference()), position });
  refresh();
  return position;
});
ipcMain.handle("krysta:fps-status", async () => ({
  available: !!(await findTool(await readPreference())),
  status,
  shortcutError,
  lastError,
  hidden,
}));
ipcMain.handle("krysta:fps-select-tool", async () => {
  if (process.platform !== "win32") return false;
  const result = await dialog.showOpenDialog({
    title: "Select official PresentMon console executable",
    properties: ["openFile"],
    filters: [{ name: "PresentMon", extensions: ["exe"] }],
  });
  if (result.canceled || !result.filePaths[0]) return false;
  const tool = result.filePaths[0];
  if (!/^presentmon.*\.exe$/i.test(basename(tool)))
    throw new Error("Select PresentMon executable");
  await savePreference({ ...(await readPreference()), tool });
  refresh();
  return true;
});
ipcMain.handle(
  "krysta:fps-hotkey",
  async () => (await readPreference()).hotkey ?? defaultHotkey
);
ipcMain.handle("krysta:fps-set-hotkey", async (_e, value: unknown) => {
  if (
    typeof value !== "string" ||
    (!/^(?:(?:Control|Alt|Shift)\+){0,3}(?:F(?:[1-9]|1[0-2])|[A-Z0-9])$/.test(
      value
    ) &&
      value !== "")
  )
    throw Error("Invalid shortcut");
  if (value && !value.includes("+") && !/^F\d+$/.test(value))
    throw Error("Use a modifier with letters or numbers");
  const pref = await readPreference();
  if (pref.enabled && !registerHotkey(value)) {
    shortcutError = true;
    throw Error("Shortcut already in use");
  }
  await savePreference({ ...(await readPreference()), hotkey: value });
  shortcutError = false;
  return value;
});
function refreshOverlayPlacement() {
  if (activeTarget) refresh();
}

if (process.platform === "win32") {
  const unsubscribe = onTrackedGamesRunningChange(() => {
    ignoredWindow = null;
    refresh();
  });
  void app.whenReady().then(() => {
    if (quitting) return;
    screen.on("display-metrics-changed", refreshOverlayPlacement);
    refresh();
    poll = setInterval(() => {
      if (
        status !== "disabled" &&
        status !== "hidden" &&
        hasTrackedGamesRunning()
      )
        refresh();
    }, 500);
    poll.unref?.();
  });
  app.on("before-quit", () => {
    quitting = true;
    revision++;
    unsubscribe();
    if (app.isReady())
      screen.removeListener("display-metrics-changed", refreshOverlayPlacement);
    if (poll) clearInterval(poll);
    if (registered) globalShortcut.unregister(registered);
    stop();
  });
}
