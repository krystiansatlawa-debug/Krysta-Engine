import { BrowserWindow, ipcMain, session } from "electron";
import { randomUUID } from "node:crypto";

const ROCKSTAR_SIGNIN = "https://signin.rockstargames.com/";
const ROCKSTAR_ORIGINS = new Set([
  "https://signin.rockstargames.com",
  "https://socialclub.rockstargames.com",
  "https://www.rockstargames.com",
  "https://rockstargames.com",
]);
let pending = false;

/**
 * User-initiated Rockstar sign-in, isolated from the main app.
 * No password, cookies or tokens are extracted or persisted.
 * This is an authentication UI foundation, NOT an authenticated API client.
 */
export async function openRockstarSignIn(): Promise<{ opened: boolean }> {
  if (pending) throw new Error("Rockstar sign-in is already open");
  pending = true;
  let window: BrowserWindow;
  let partition: Electron.Session;
  try {
    partition = session.fromPartition("krysta-rockstar-login-" + randomUUID());
    window = new BrowserWindow({
    width: 520,
    height: 760,
    title: "Rockstar Games — Sign in",
    webPreferences: {
      session: partition,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  } catch (error) {
    pending = false;
    throw error;
  }
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" && ROCKSTAR_ORIGINS.has(parsed.origin)) {
        void window.loadURL(parsed.toString()).catch(() => {});
      }
    } catch { /* invalid link */ }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" && ROCKSTAR_ORIGINS.has(parsed.origin)) return;
    } catch { /* invalid URL */ }
    event.preventDefault();
  });
  try {
    await window.loadURL(ROCKSTAR_SIGNIN);
    return { opened: true };
  } catch {
    if (!window.isDestroyed()) window.destroy();
    throw new Error("Could not open Rockstar sign-in");
  } finally {
    // Do not clear the temporary session until the sign-in window closes.
    if (!window.isDestroyed()) {
      window.once("closed", () => {
        pending = false;
        void partition.clearStorageData().catch(() => {});
      });
    } else {
      pending = false;
      await partition.clearStorageData().catch(() => {});
    }
  }
}

ipcMain.handle("krysta:rockstar-sign-in", () => openRockstarSignIn());
