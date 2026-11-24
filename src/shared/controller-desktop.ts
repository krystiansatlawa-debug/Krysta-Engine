export interface DesktopControllerSettings {
  enabled: boolean;
  cursorSpeed: number;
  deadZone: number;
  bindings?: Record<string, number>;
}

export const defaultDesktopControllerSettings: DesktopControllerSettings = {
  enabled: false,
  cursorSpeed: 12,
  deadZone: 0.18,
};

// Standard browser Gamepad button numbering, also used by the native backends.
// A missing override uses this default and -1 explicitly disables an action.
export const controllerDesktopBindings = {
  left: 0,
  right: 1,
  doubleClick: 2,
  switchWindow: 3,
  volumeDown: 4,
  volumeUp: 5,
  minimize: 13,
  maximize: 12,
  keyboard: 8,
  copy: 14,
  paste: 15,
  selectAll: 11,
  cut: -1,
  showDesktop: -1,
  nextDisplay: -1,
  displayMode: -1,
} as const;

export type ControllerDesktopBinding = keyof typeof controllerDesktopBindings;

const controllerBindingNames = Object.keys(
  controllerDesktopBindings
) as ControllerDesktopBinding[];
const shortcutBindings = controllerBindingNames.filter(
  (name): name is Exclude<ControllerDesktopBinding, "left" | "right"> =>
    name !== "left" && name !== "right"
);

export type DesktopAction =
  | { type: "move"; x: number; y: number }
  | { type: "scroll"; x: number; y: number }
  | { type: "mouse"; button: "left" | "right"; down: boolean }
  | { type: (typeof shortcutBindings)[number] };

export interface DesktopPadFrame {
  axes: readonly number[];
  buttons: readonly boolean[];
}

export interface ControllerProfile extends DesktopControllerSettings {
  vibration: boolean;
  bindings: Record<string, number>;
}

export interface WindowsDesktopControllerDevice {
  id: string;
  name: string;
  layout: "xbox" | "dualsense";
}

export interface WindowsDesktopControllerSettings {
  enabled: boolean;
  autoShowKeyboard: boolean;
  preferredDeviceId: string | null;
  profiles: Record<string, ControllerProfile>;
}

export const defaultControllerProfile = (): ControllerProfile => ({
  ...defaultDesktopControllerSettings,
  vibration: true,
  bindings: {},
});

export const defaultWindowsControllerProfile = (): ControllerProfile => ({
  ...defaultControllerProfile(),
  enabled: true,
});

export const defaultWindowsDesktopControllerSettings =
  (): WindowsDesktopControllerSettings => ({
    enabled: false,
    autoShowKeyboard: false,
    preferredDeviceId: null,
    profiles: {},
  });

export const getControllerBinding = (
  profile: DesktopControllerSettings,
  name: ControllerDesktopBinding
) => profile.bindings?.[name] ?? controllerDesktopBindings[name];

export function setControllerBinding(
  profile: ControllerProfile,
  action: ControllerDesktopBinding,
  button: number,
  candidates: readonly ControllerDesktopBinding[] = controllerBindingNames
): ControllerProfile {
  if (!Number.isInteger(button) || button < -1 || button >= 32) return profile;
  const previous = getControllerBinding(profile, action);
  if (button === previous) return profile;

  const bindings = { ...profile.bindings, [action]: button };
  if (button >= 0) {
    for (const candidate of candidates) {
      if (
        candidate !== action &&
        getControllerBinding(profile, candidate) === button
      ) {
        bindings[candidate] = previous;
        break;
      }
    }
  }
  return { ...profile, bindings };
}

export function desktopAxis(value: number, deadZone: number): number {
  if (!Number.isFinite(value)) return 0;
  const zone = Math.max(0, Math.min(0.9, deadZone));
  const magnitude = Math.min(1, Math.abs(value));
  return magnitude <= zone
    ? 0
    : (Math.sign(value) * (magnitude - zone)) / (1 - zone);
}

export function desktopActions(
  current: DesktopPadFrame | null,
  previous: DesktopPadFrame | null,
  settings: DesktopControllerSettings,
  gameRunning: boolean
): DesktopAction[] {
  const actions: DesktopAction[] = [];
  const active = settings.enabled && !gameRunning ? current : null;
  const down = (index: number) => Boolean(active?.buttons[index]);
  const was = (index: number) => Boolean(previous?.buttons[index]);
  const left = getControllerBinding(settings, "left");
  const right = getControllerBinding(settings, "right");

  if (down(left) !== was(left))
    actions.push({ type: "mouse", button: "left", down: down(left) });
  if (down(right) !== was(right))
    actions.push({ type: "mouse", button: "right", down: down(right) });
  if (!active) return actions;

  const speed = Number.isFinite(settings.cursorSpeed)
    ? Math.max(1, Math.min(40, settings.cursorSpeed))
    : 12;
  const zone = Number.isFinite(settings.deadZone) ? settings.deadZone : 0.18;
  const axis = (index: number) => desktopAxis(active.axes[index] ?? 0, zone);
  const x = axis(0) * speed;
  const y = axis(1) * speed;
  if (x || y) actions.push({ type: "move", x, y });
  const sx = axis(2);
  const sy = axis(3);
  if (sx || sy) actions.push({ type: "scroll", x: sx, y: sy });

  for (const name of shortcutBindings) {
    const index = getControllerBinding(settings, name);
    if (!down(index) || was(index)) continue;
    if (name === "doubleClick" && (down(left) || down(right))) continue;
    actions.push({ type: name });
  }
  return actions;
}

/** Releases the old profile's inputs and requires a neutral frame before injection. */
export class DesktopControllerSession {
  private previous: DesktopPadFrame | null = null;
  private controllerId: string | null = null;
  private settings: DesktopControllerSettings | null = null;
  private armed = false;

  update(
    id: string | null,
    frame: DesktopPadFrame | null,
    settings: DesktopControllerSettings,
    suspended: boolean
  ): DesktopAction[] {
    if (suspended || !settings.enabled || !frame || id === null)
      return this.reset();

    const actions =
      id !== this.controllerId || settings !== this.settings
        ? this.reset()
        : [];
    this.controllerId = id;
    this.settings = settings;
    if (!this.armed) {
      // A slightly wider threshold on reentry accommodates resting stick drift.
      // It does not inject that drift because the first neutral frame is consumed.
      const neutralZone = Math.max(settings.deadZone, 0.12);
      if (
        !frame.buttons.some(Boolean) &&
        frame.axes.every((axis) => Math.abs(axis) <= neutralZone)
      ) {
        this.armed = true;
      }
      return actions;
    }

    actions.push(...desktopActions(frame, this.previous, settings, false));
    this.previous = frame;
    return actions;
  }

  reset(): DesktopAction[] {
    const actions = this.settings
      ? desktopActions(null, this.previous, this.settings, true)
      : [];
    this.previous = null;
    this.controllerId = null;
    this.settings = null;
    this.armed = false;
    return actions;
  }
}

export function normalizeDesktopControllerSettings(
  value: Partial<DesktopControllerSettings>
): DesktopControllerSettings {
  return {
    enabled: value.enabled === true,
    cursorSpeed:
      typeof value.cursorSpeed === "number" &&
      Number.isFinite(value.cursorSpeed)
        ? Math.max(1, Math.min(40, value.cursorSpeed))
        : 12,
    deadZone:
      typeof value.deadZone === "number" && Number.isFinite(value.deadZone)
        ? Math.max(0, Math.min(0.9, value.deadZone))
        : 0.18,
  };
}

export function controllerProfileKey(name: string, layout: string): string {
  return JSON.stringify([
    name.trim().toLowerCase(),
    layout.trim().toLowerCase(),
  ]);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizeControllerProfile(value: unknown): ControllerProfile {
  const input = asRecord(value) as Partial<ControllerProfile>;
  const bindings: Record<string, number> = {};
  for (const [key, index] of Object.entries(asRecord(input.bindings))) {
    if (
      Object.hasOwn(controllerDesktopBindings, key) &&
      typeof index === "number" &&
      Number.isInteger(index) &&
      index >= -1 &&
      index < 32
    ) {
      bindings[key] = index;
    }
  }
  return {
    ...normalizeDesktopControllerSettings(input),
    vibration: input.vibration !== false,
    bindings,
  };
}

function normalizeWindowsControllerProfile(value: unknown): ControllerProfile {
  const profile = normalizeControllerProfile({
    ...defaultWindowsControllerProfile(),
    ...asRecord(value),
  });
  const reserved = new Set<number>();
  // An explicit binding takes precedence over a default that uses the same button.
  for (const action of [
    ...controllerBindingNames.filter((name) =>
      Object.hasOwn(profile.bindings, name)
    ),
    ...controllerBindingNames.filter(
      (name) => !Object.hasOwn(profile.bindings, name)
    ),
  ]) {
    const button = getControllerBinding(profile, action);
    if (button < 0) continue;
    if (reserved.has(button)) profile.bindings[action] = -1;
    else reserved.add(button);
  }
  return profile;
}

const controllerDeviceIdPattern = /^(?:xbox:[0-3]|dualsense:[a-f0-9]{32})$/;

export function updateWindowsDesktopControllerSettings(
  previous: WindowsDesktopControllerSettings,
  value: unknown
): WindowsDesktopControllerSettings {
  const patch = asRecord(value);
  const profiles = { ...previous.profiles };
  let profileCount = Object.keys(profiles).length;
  for (const [id, profile] of Object.entries(asRecord(patch.profiles)).slice(
    0,
    128
  )) {
    if (!controllerDeviceIdPattern.test(id)) continue;
    if (!Object.hasOwn(profiles, id) && ++profileCount > 128) continue;
    profiles[id] = normalizeWindowsControllerProfile(profile);
  }
  return {
    enabled:
      typeof patch.enabled === "boolean" ? patch.enabled : previous.enabled,
    autoShowKeyboard:
      typeof patch.autoShowKeyboard === "boolean"
        ? patch.autoShowKeyboard
        : previous.autoShowKeyboard,
    preferredDeviceId:
      patch.preferredDeviceId === null ||
      (typeof patch.preferredDeviceId === "string" &&
        controllerDeviceIdPattern.test(patch.preferredDeviceId))
        ? patch.preferredDeviceId
        : previous.preferredDeviceId,
    profiles,
  };
}
