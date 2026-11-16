import updater from "electron-updater";

// Krysta releases are checked separately in krysta-updates.ts.
// Never allow an inherited or cached Hydra update to install on exit.
const { autoUpdater } = updater;
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

export class UpdateManager {
  public static async checkForUpdates() {
    return false;
  }
}
