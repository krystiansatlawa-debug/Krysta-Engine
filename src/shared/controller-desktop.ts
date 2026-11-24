export interface DesktopControllerSettings {
  enabled: boolean;
  cursorSpeed: number;
  deadZone: number;
}
export const defaultDesktopControllerSettings: DesktopControllerSettings = {
  enabled: false, cursorSpeed: 12, deadZone: 0.18,
};
export type DesktopAction =
  | { type: "move"; x: number; y: number }
  | { type: "scroll"; x: number; y: number }
  | { type: "mouse"; button: "left" | "right"; down: boolean }
  | { type: "doubleClick" }
  | { type: "volume"; direction: 1 | -1 }
  | { type: "switchWindow" | "minimize" | "maximize" };
export interface DesktopPadFrame {
  axes: readonly number[];
  buttons: readonly boolean[];
}
export function desktopAxis(value: number, deadZone: number): number {
  if (!Number.isFinite(value)) return 0;
  const zone = Math.max(0, Math.min(0.9, deadZone));
  const magnitude = Math.min(1, Math.abs(value));
  return magnitude <= zone ? 0 : Math.sign(value) * (magnitude - zone) / (1 - zone);
}
export function desktopActions(
  current: DesktopPadFrame | null,
  previous: DesktopPadFrame | null,
  settings: DesktopControllerSettings,
  gameRunning: boolean
): DesktopAction[] {
  const actions: DesktopAction[] = [];
  const active = settings.enabled && !gameRunning ? current : null;
  const down = (i: number) => Boolean(active?.buttons[i]);
  const was = (i: number) => Boolean(previous?.buttons[i]);
  const pressed = (i: number) => down(i) && !was(i);
  const bindings = normalizeControllerProfile(settings).bindings;
  const bind = (action: string, fallback: number) => bindings[action] ?? fallback;
  for (const [index, button] of [[bind("left", 0), "left"], [bind("right", 1), "right"]] as const) {
    if (down(index) !== was(index)) actions.push({ type: "mouse", button, down: down(index) });
  }
  if (!active) return actions;
  const speed = Number.isFinite(settings.cursorSpeed) ? Math.max(1, Math.min(40, settings.cursorSpeed)) : 12;
  const zone = Number.isFinite(settings.deadZone) ? settings.deadZone : 0.18;
  const axis = (i: number) => desktopAxis(active.axes[i] ?? 0, zone);
  const x = axis(0) * speed, y = axis(1) * speed;
  if (x || y) actions.push({ type: "move", x, y });
  const sx = axis(2), sy = axis(3);
  if (sx || sy) actions.push({ type: "scroll", x: sx, y: sy });
  if (pressed(bind("doubleClick", 2)) && !down(bind("left", 0)) && !down(bind("right", 1))) actions.push({ type: "doubleClick" });
  if (pressed(bind("volumeDown", 4))) actions.push({ type: "volume", direction: -1 });
  if (pressed(bind("volumeUp", 5))) actions.push({ type: "volume", direction: 1 });
  if (pressed(bind("switchWindow", 3))) actions.push({ type: "switchWindow" });
  if (pressed(bind("minimize", 13))) actions.push({ type: "minimize" });
  if (pressed(bind("maximize", 12))) actions.push({ type: "maximize" });
  return actions;
}

/** Keeps injected input separate from physical input and requires neutral buttons
 * after a game, disconnect or controller change before desktop input resumes. */
export class DesktopControllerSession {
  private previous: DesktopPadFrame | null = null;
  private controllerId: string | null = null;
  private armed = false;

  update(id: string | null, frame: DesktopPadFrame | null, settings: DesktopControllerSettings, gameRunning: boolean): DesktopAction[] {
    if (!settings.enabled || gameRunning || !frame || id === null || id !== this.controllerId) {
      const release = desktopActions(null, this.previous, settings, true);
      this.previous = null;
      this.armed = false;
      this.controllerId = id;
      return release;
    }
    if (!this.armed) {
      if (frame.buttons.some(Boolean) || frame.axes.some((axis) => Math.abs(axis) > 0.18)) return [];
      this.armed = true;
    }
    const actions = desktopActions(frame, this.previous, settings, false);
    this.previous = { axes: [...frame.axes], buttons: [...frame.buttons] };
    return actions;
  }

  reset(): DesktopAction[] {
    return this.update(null, null, defaultDesktopControllerSettings, true);
  }
}

export function normalizeDesktopControllerSettings(value: Partial<DesktopControllerSettings>): DesktopControllerSettings {
  return {
    enabled: value.enabled === true,
    cursorSpeed: typeof value.cursorSpeed === "number" && Number.isFinite(value.cursorSpeed) ? Math.max(1, Math.min(40, value.cursorSpeed)) : 12,
    deadZone: typeof value.deadZone === "number" && Number.isFinite(value.deadZone) ? Math.max(0, Math.min(0.9, value.deadZone)) : 0.18,
  };
}

export interface ControllerProfile extends DesktopControllerSettings {
  vibration: boolean;
  bindings: Record<string, number>;
}
export const defaultControllerProfile = (): ControllerProfile => ({
  ...defaultDesktopControllerSettings, vibration: true, bindings: {},
});
export function controllerProfileKey(name: string, layout: string): string {
  return JSON.stringify([name.trim().toLowerCase(), layout.trim().toLowerCase()]);
}
export function normalizeControllerProfile(value: unknown): ControllerProfile {
  const input = value && typeof value === "object" ? value as Partial<ControllerProfile> : {};
  const bindings: Record<string, number> = {};
  for (const [key, index] of Object.entries(input.bindings ?? {})) {
    if (/^(left|right|doubleClick|volumeUp|volumeDown|switchWindow|minimize|maximize)$/.test(key) && Number.isInteger(index) && index >= 0 && index < 32) bindings[key] = index;
  }
  return { ...normalizeDesktopControllerSettings(input), vibration: input.vibration !== false, bindings };
}
