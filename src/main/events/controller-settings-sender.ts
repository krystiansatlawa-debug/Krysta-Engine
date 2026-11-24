import { WindowManager } from "@main/services/window-manager";

export const isControllerSettingsSender = (
  event: Electron.IpcMainInvokeEvent
) =>
  event.senderFrame === event.sender.mainFrame &&
  WindowManager.appWindows.some(
    (window) =>
      window && !window.isDestroyed() && window.webContents === event.sender
  );
