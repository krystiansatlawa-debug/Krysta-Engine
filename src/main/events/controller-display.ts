import { app, screen } from "electron";
import { ControllerDisplay } from "@main/services/controller-display";
import { logger } from "@main/services/logger";
import { WindowManager } from "@main/services/window-manager";
import { isControllerSettingsSender } from "./controller-settings-sender";
import { registerEvent } from "./register-event";

registerEvent("getWindowsControllerDisplays", (event) =>
  isControllerSettingsSender(event) ? ControllerDisplay.getDisplays() : []
);
registerEvent("getControllerDisplaySettings", (event) => {
  if (!isControllerSettingsSender(event))
    throw new Error("Invalid controller settings window");
  return ControllerDisplay.getSettings();
});
registerEvent("setControllerDisplaySettings", async (event, patch: unknown) => {
  if (!isControllerSettingsSender(event))
    throw new Error("Invalid controller settings window");
  const settings = await ControllerDisplay.updateSettings(patch);
  WindowManager.sendToAppWindows(
    "controller-display-settings-changed",
    settings
  );
  return settings;
});
registerEvent(
  "setControllerDisplayMode",
  (event, mode: unknown, id?: unknown) =>
    isControllerSettingsSender(event) &&
    ControllerDisplay.setDisplayMode(mode, id)
);

if (process.platform === "win32") {
  void app.whenReady().then(() => {
    void ControllerDisplay.getSettings().catch((error: unknown) => {
      logger.warn("Failed to load controller display preferences", error);
    });

    let updateTimer: NodeJS.Timeout | undefined;
    const notifyTopologyChanged = () => {
      if (updateTimer) clearTimeout(updateTimer);
      updateTimer = setTimeout(() => {
        updateTimer = undefined;
        ControllerDisplay.handleTopologyChanged();
        WindowManager.sendToAppWindows("controller-displays-changed");
      }, 250);
      updateTimer.unref();
    };
    screen.on("display-added", notifyTopologyChanged);
    screen.on("display-removed", notifyTopologyChanged);
    screen.on("display-metrics-changed", notifyTopologyChanged);
    app.once("will-quit", () => {
      screen.off("display-added", notifyTopologyChanged);
      screen.off("display-removed", notifyTopologyChanged);
      screen.off("display-metrics-changed", notifyTopologyChanged);
      if (updateTimer) clearTimeout(updateTimer);
      ControllerDisplay.shutdown();
    });
  });
}
