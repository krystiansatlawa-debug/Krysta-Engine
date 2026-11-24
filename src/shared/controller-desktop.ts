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
  for (const [index, button] of [[0, "left"], [1, "right"]] as const) {
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
  if (pressed(2) && !down(0) && !down(1)) actions.push({ type: "doubleClick" });
  if (pressed(4)) actions.push({ type: "volume", direction: -1 });
  if (pressed(5)) actions.push({ type: "volume", direction: 1 });
  if (pressed(3)) actions.push({ type: "switchWindow" });
  if (pressed(13)) actions.push({ type: "minimize" });
  if (pressed(12)) actions.push({ type: "maximize" });
  return actions;
}
