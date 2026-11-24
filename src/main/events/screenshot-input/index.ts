import { ScreenshotInputService } from "@main/services/screenshot-input";
import { WindowManager } from "@main/services/window-manager";
import {
  beginControllerShortcutCapture,
  endControllerShortcutCapture,
} from "@main/services/controller-shortcut-capture";
import { registerEvent } from "../register-event";

import "./get-screenshot-input-status";

registerEvent("beginControllerShortcutCapture", (event) =>
  beginControllerShortcutCapture(event.sender)
);
registerEvent("endControllerShortcutCapture", (event, token: unknown) =>
  endControllerShortcutCapture(event.sender, token)
);

ScreenshotInputService.onStatusChange((status) => {
  WindowManager.sendToAppWindows("on-screenshot-input-status-change", status);
});
