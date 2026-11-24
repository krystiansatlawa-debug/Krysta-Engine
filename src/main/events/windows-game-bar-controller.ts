import {
  hasTrackedGamesRunning,
  onTrackedGamesRunningChange,
} from "../services/game-running-state";
import { app, screen, BrowserWindow } from "electron";
import { DesktopController } from "@main/services/desktop-controller";
import { WindowManager } from "@main/services/window-manager";
import { NativeAddon } from "@main/services/native-addon";
import { isControllerSettingsSender } from "./controller-settings-sender";
import { registerEvent } from "./register-event";

registerEvent("getWindowsGameBarControllerEnabled", () =>
  NativeAddon.getWindowsGameBarControllerEnabled()
);

registerEvent("setWindowsGameBarControllerEnabled", (_, enabled: unknown) => {
  if (typeof enabled !== "boolean") {
    throw new TypeError(
      "Expected a boolean for the Game Bar controller setting"
    );
  }

  return NativeAddon.setWindowsGameBarControllerEnabled(enabled);
});

registerEvent("getWindowsXboxBatteryLevels", () =>
  Array.from({ length: 4 }, (_, index) =>
    NativeAddon.getWindowsXboxBatteryLevel(index)
  )
);

/** Windows Bluetooth battery property, when exposed by the controller driver.
 * Do not infer a battery level from a missing property. */
registerEvent("getWindowsSonyBatteryLevels", async () => {
  if (process.platform !== "win32") return [];
  const hid = await NativeAddon.getWindowsSonyHidBatteries();
  if (hid.length) return hid;
  const { execFile } = await import("node:child_process");
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$devices = Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match '^(BTHENUM|BTHLEDEVICE)' -and ($_.FriendlyName -match 'DualSense|Wireless Controller' -or $_.InstanceId -match 'VID&0002054C') }",
    "$rows = @($devices | ForEach-Object { $d = $_; $p = Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2'; if ($null -ne $p.Data -and $p.Data -ge 0 -and $p.Data -le 100) { [PSCustomObject]@{ id = $d.InstanceId; name = $d.FriendlyName; percent = [int]$p.Data } } })",
    "ConvertTo-Json -InputObject $rows -Compress",
  ].join("; ");
  return new Promise<unknown[]>((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, timeout: 8000, maxBuffer: 65536 },
      (error, stdout) => {
        if (error) return resolve([]);
        try {
          const rows: unknown = JSON.parse(stdout);
          resolve(Array.isArray(rows) ? rows : []);
        } catch {
          resolve([]);
        }
      }
    );
  });
});

registerEvent("getControllerDesktopDisplays", () => {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((display) => ({
    id: display.id,
    label: display.label || `Ekran ${display.id}`,
    primary: display.id === primary,
    width: display.size.width,
    height: display.size.height,
    scaleFactor: display.scaleFactor,
  }));
});

registerEvent("moveControllerWindowToDisplay", (event, displayId: unknown) => {
  if (typeof displayId !== "number" || !Number.isSafeInteger(displayId))
    return false;
  const display = screen.getAllDisplays().find((item) => item.id === displayId);
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!display || !window || window.isDestroyed()) return false;
  const fullscreen = window.isFullScreen();
  const maximized = window.isMaximized();
  const move = () => {
    if (window.isDestroyed()) return;
    const target = screen
      .getAllDisplays()
      .find((item) => item.id === displayId);
    if (!target) return;
    const area = target.workArea;
    const bounds = window.getBounds();
    const width = Math.min(bounds.width, area.width);
    const height = Math.min(bounds.height, area.height);
    window.setBounds({
      x: area.x + Math.floor((area.width - width) / 2),
      y: area.y + Math.floor((area.height - height) / 2),
      width,
      height,
    });
    if (fullscreen) window.setFullScreen(true);
    else if (maximized) window.maximize();
  };
  if (fullscreen) {
    window.once("leave-full-screen", move);
    window.setFullScreen(false);
  } else {
    if (maximized) window.unmaximize();
    move();
  }
  return true;
});

registerEvent("getDesktopControllerSettings", (event) => {
  if (!isControllerSettingsSender(event))
    throw new Error("Invalid controller settings window");
  return DesktopController.readSettings();
});

registerEvent("updateDesktopControllerSettings", (event, patch: unknown) => {
  if (!isControllerSettingsSender(event))
    throw new Error("Invalid controller settings window");
  return DesktopController.updateSettings(patch);
});

registerEvent("getDesktopControllerDevices", (event) => {
  if (!isControllerSettingsSender(event)) return [];
  return DesktopController.getDevices();
});

// The optional Big Picture pointer is a separate foreground-only input source.
const heldControllerButtons = new Set<"left" | "right">();
let foregroundOwner: Electron.WebContents | undefined;
const watchedSenders = new WeakSet<Electron.WebContents>();
const releaseControllerButtons = () => {
  for (const button of heldControllerButtons)
    NativeAddon.controllerDesktopAction(`${button}Up`, 0);
  heldControllerButtons.clear();
  foregroundOwner = undefined;
};
const hasFocusedBigPictureSender = (event: Electron.IpcMainInvokeEvent) =>
  process.platform === "win32" &&
  event.senderFrame === event.sender.mainFrame &&
  WindowManager.isBigPictureSender(event.sender) &&
  WindowManager.bigPictureWindow?.isFocused() === true;

onTrackedGamesRunningChange(() => {
  if (hasTrackedGamesRunning()) releaseControllerButtons();
});
app.on("browser-window-blur", (_event, window) => {
  if (foregroundOwner === window.webContents) releaseControllerButtons();
});
app.on("will-quit", releaseControllerButtons);

registerEvent("moveControllerCursor", (event, dx: unknown, dy: unknown) => {
  if (
    !hasFocusedBigPictureSender(event) ||
    hasTrackedGamesRunning() ||
    typeof dx !== "number" ||
    typeof dy !== "number" ||
    !Number.isInteger(dx) ||
    !Number.isInteger(dy) ||
    Math.abs(dx) > 40 ||
    Math.abs(dy) > 40
  )
    return false;
  return NativeAddon.moveControllerCursor(dx, dy);
});

registerEvent(
  "controllerPointerAction",
  (event, action: unknown, value: unknown) => {
    if (action === "releaseAll" && foregroundOwner === event.sender) {
      releaseControllerButtons();
      return true;
    }
    if (
      !hasFocusedBigPictureSender(event) ||
      hasTrackedGamesRunning() ||
      typeof action !== "string"
    )
      return false;

    if (
      action === "leftUp" ||
      action === "rightUp" ||
      action === "leftDown" ||
      action === "rightDown"
    ) {
      const button = action.startsWith("left") ? "left" : "right";
      const down = action.endsWith("Down");
      if (heldControllerButtons.has(button) === down) return true;
      const successful = NativeAddon.controllerDesktopAction(action, 0);
      if (!successful) return false;
      if (down) {
        heldControllerButtons.add(button);
        foregroundOwner = event.sender;
        if (!watchedSenders.has(event.sender)) {
          const sender = event.sender;
          watchedSenders.add(sender);
          sender.once("destroyed", () => {
            if (foregroundOwner === sender) releaseControllerButtons();
          });
        }
      } else {
        heldControllerButtons.delete(button);
      }
      return true;
    }
    if (action === "scroll" || action === "horizontalScroll") {
      return (
        typeof value === "number" &&
        Number.isInteger(value) &&
        Math.abs(value) <= 3 &&
        NativeAddon.controllerDesktopAction(action, value)
      );
    }
    if (
      [
        "doubleClick",
        "leftClick",
        "rightClick",
        "volumeUp",
        "volumeDown",
        "switchWindow",
        "minimize",
        "maximize",
        "showDesktop",
      ].includes(action)
    ) {
      if (
        heldControllerButtons.size &&
        (action === "doubleClick" || action.endsWith("Click"))
      )
        return false;
      return NativeAddon.controllerDesktopAction(action, 0);
    }
    return false;
  }
);
