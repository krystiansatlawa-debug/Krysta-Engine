import { app, BrowserWindow, screen } from "electron";
import toastHtml from "@resources/krysta-recording-toast.html?asset";

export type RecordingNotice = "started" | "saved" | "failed";
let overlay: BrowserWindow | null = null;
let dismiss: ReturnType<typeof setTimeout> | null = null;

/** Temporary, click-through Windows toast. It never activates or focuses. */
export async function showRecordingNotice(state: RecordingNotice) {
  if (process.platform !== "win32" || !app.isReady()) return;
  if (dismiss) clearTimeout(dismiss);
  dismiss = null;
  if (overlay && !overlay.isDestroyed()) overlay.destroy();
  overlay = null;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const width = 354;
  const height = 92;
  const win = new BrowserWindow({
    x: display.workArea.x + display.workArea.width - width - 18,
    y: display.workArea.y + 18,
    width, height,
    frame: false,
    show: false,
    transparent: true,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  overlay = win;
  try {
    win.setIgnoreMouseEvents(true, { forward: true });
    win.setAlwaysOnTop(true, "screen-saver");
    await win.loadFile(toastHtml, { query: { state } });
    if (win.isDestroyed() || overlay !== win) return;
    win.showInactive();
    dismiss = setTimeout(() => {
      if (!win.isDestroyed()) win.destroy();
      if (overlay === win) overlay = null;
      dismiss = null;
    }, 3000);
    dismiss.unref?.();
  } catch {
    if (!win.isDestroyed()) win.destroy();
    if (overlay === win) overlay = null;
  }
}

app.on("before-quit", () => {
  if (dismiss) clearTimeout(dismiss);
  if (overlay && !overlay.isDestroyed()) overlay.destroy();
  overlay = null;
});
