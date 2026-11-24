export interface ControllerDisplay {
  id: string;
  label: string;
  active: boolean;
  hdmi: boolean;
  internal: boolean;
}

export type ControllerDisplayMode = "display" | "duplicate" | "extend";

export interface ControllerDisplaySettings {
  preferredDisplayId: string | null;
  autoSwitchToTv: boolean;
  restoreDisplayAfterGame: boolean;
  switchHdmiAudio: boolean;
}

export const defaultControllerDisplaySettings: ControllerDisplaySettings = {
  preferredDisplayId: null,
  autoSwitchToTv: false,
  restoreDisplayAfterGame: true,
  switchHdmiAudio: false,
};

export function readControllerDisplaySettings(
  value: unknown
): Partial<ControllerDisplaySettings> {
  if (!value || typeof value !== "object") return {};
  const patch: Partial<ControllerDisplaySettings> = {};
  if ("preferredDisplayId" in value) {
    const id = value.preferredDisplayId;
    if (
      id === null ||
      (typeof id === "string" && id.length > 0 && id.length <= 512)
    ) {
      patch.preferredDisplayId = id;
    }
  }
  for (const key of [
    "autoSwitchToTv",
    "restoreDisplayAfterGame",
    "switchHdmiAudio",
  ] as const) {
    const enabled = (value as Record<string, unknown>)[key];
    if (typeof enabled === "boolean") patch[key] = enabled;
  }
  return patch;
}

export function resolveControllerTelevision(
  displays: ControllerDisplay[],
  id: string | null
): ControllerDisplay | undefined {
  if (id) return displays.find((display) => display.id === id);
  const hdmiDisplays = displays.filter(
    (display) => display.hdmi && !display.internal
  );
  return hdmiDisplays.length === 1 ? hdmiDisplays[0] : undefined;
}
