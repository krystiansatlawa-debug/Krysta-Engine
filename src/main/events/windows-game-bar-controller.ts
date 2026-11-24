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
