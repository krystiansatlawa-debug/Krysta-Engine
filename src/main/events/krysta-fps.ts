// FPS monitoring was retired to reduce gameplay overhead.
// Keep inert IPC compatibility for older renderer builds. Recording uses
// separate IPC handlers and is intentionally unaffected.
import { ipcMain } from "electron";

ipcMain.handle("krysta:fps-preference", () => false);
ipcMain.handle("krysta:fps-set-preference", () => false);
ipcMain.handle("krysta:fps-position", () => "tl");
ipcMain.handle("krysta:fps-set-position", () => "tl");
ipcMain.handle("krysta:fps-status", () => ({
  available: false,
  output: "window",
  rtssAvailable: false,
  rtssReceiving: false,
  status: "disabled",
  shortcutError: false,
  lastError: "",
  hidden: true,
}));
ipcMain.handle("krysta:fps-set-output", () => "window");
ipcMain.handle("krysta:fps-select-tool", () => false);
ipcMain.handle("krysta:fps-hotkey", () => "");
ipcMain.handle("krysta:fps-set-hotkey", () => "");
