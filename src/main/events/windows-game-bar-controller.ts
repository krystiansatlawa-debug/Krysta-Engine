import { NativeAddon } from "@main/services/native-addon";
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
  Array.from({ length: 4 }, (_, index) => NativeAddon.getWindowsXboxBatteryLevel(index))
);

/** Windows Bluetooth battery property, when exposed by the controller driver.
 * Do not infer a battery level from a missing property. */
registerEvent("getWindowsSonyBatteryLevels", async () => {
  if (process.platform !== "win32") return [];
  const { execFile } = await import("node:child_process");
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$devices = Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match '^(BTHENUM|BTHLEDEVICE)' -and ($_.FriendlyName -match 'DualSense|Wireless Controller' -or $_.InstanceId -match 'VID&0002054C') }",
    "$rows = @($devices | ForEach-Object { $d = $_; $p = Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2'; if ($null -ne $p.Data -and $p.Data -ge 0 -and $p.Data -le 100) { [PSCustomObject]@{ id = $d.InstanceId; name = $d.FriendlyName; percent = [int]$p.Data } } })",
    "ConvertTo-Json -InputObject $rows -Compress"
  ].join("; ");
  return new Promise<unknown[]>((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 8000, maxBuffer: 65536 }, (error, stdout) => {
      if (error) return resolve([]);
      try { const rows: unknown = JSON.parse(stdout); resolve(Array.isArray(rows) ? rows : []); }
      catch { resolve([]); }
    });
  });
});
