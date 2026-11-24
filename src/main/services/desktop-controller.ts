import { db, levelKeys } from "@main/level";
import { WindowManager } from "@main/services/window-manager";
import {
  defaultWindowsControllerProfile,
  defaultWindowsDesktopControllerSettings,
  DesktopControllerSession,
  updateWindowsDesktopControllerSettings,
  type DesktopAction,
  type WindowsDesktopControllerSettings,
} from "../../shared/controller-desktop";
import { ControllerDisplay } from "./controller-display";
import {
  hasTrackedGamesRunning,
  onTrackedGamesRunningChange,
} from "./game-running-state";
import { logger } from "./logger";
import { NativeAddon } from "./native-addon";

const activePollMs = 25;
const idlePollMs = 50;
const noDevicePollMs = 400;
const scrollRepeatMs = 110;
const keyboardFocusPollMs = 450;
const defaultProfile = defaultWindowsControllerProfile();

export class DesktopController {
  private static settings = defaultWindowsDesktopControllerSettings();
  private static ready: Promise<void> | undefined;
  private static pendingWrite = Promise.resolve();
  private static shouldRun = false;
  private static suspended = false;
  private static polling: ReturnType<typeof setTimeout> | undefined;
  private static readonly session = new DesktopControllerSession();
  private static readonly mouseButtons = new Set<"left" | "right">();
  private static lastScrollAt = 0;
  private static lastInputAt = 0;
  private static activeDeviceId: string | undefined;
  private static bigPictureFocused = false;
  private static keyboardFocusPending = false;
  private static keyboardFocusAt = 0;
  private static lastEditableFocus: string | undefined;
  private static lastKeyboardAt = Number.NEGATIVE_INFINITY;
  private static generation = 0;
  private static unsubscribeGames: (() => void) | undefined;

  public static async start(): Promise<void> {
    if (process.platform !== "win32") return;
    this.shouldRun = true;
    await this.readSettings();
    if (!this.shouldRun) return;
    this.unsubscribeGames ??= onTrackedGamesRunningChange(() =>
      this.syncRuntime()
    );
    this.syncRuntime();
  }

  private static async loadSettings() {
    const stored = await db.get<string, unknown>(
      levelKeys.desktopControllerSettings,
      { valueEncoding: "json" }
    );
    this.settings = updateWindowsDesktopControllerSettings(
      this.settings,
      stored
    );
    ControllerDisplay.setModuleEnabled(this.settings.enabled);
  }

  public static stop() {
    this.shouldRun = false;
    this.unsubscribeGames?.();
    this.unsubscribeGames = undefined;
    this.stopPolling();
  }

  public static suspend() {
    this.suspended = true;
    this.stopPolling();
  }

  public static resume() {
    this.suspended = false;
    this.syncRuntime();
  }

  public static getSettings() {
    return this.settings;
  }

  public static async readSettings() {
    if (process.platform === "win32") {
      this.ready ??= this.loadSettings().catch((error) => {
        this.ready = undefined;
        throw error;
      });
      await this.ready;
    }
    return this.getSettings();
  }

  public static async updateSettings(
    patch: unknown
  ): Promise<WindowsDesktopControllerSettings> {
    if (process.platform !== "win32") return this.settings;
    await this.readSettings();
    const write = this.pendingWrite.then(async () => {
      const update = updateWindowsDesktopControllerSettings(
        this.settings,
        patch
      );
      if (JSON.stringify(update) === JSON.stringify(this.settings))
        return this.settings;
      await db.put<string, WindowsDesktopControllerSettings>(
        levelKeys.desktopControllerSettings,
        update,
        { valueEncoding: "json" }
      );
      const previous = this.settings;
      const toggled = previous.enabled !== update.enabled;
      this.settings = update;
      const activeId = this.activeDeviceId;
      if (
        update.enabled &&
        (previous.preferredDeviceId !== update.preferredDeviceId ||
          (activeId &&
            previous.profiles[activeId] !== update.profiles[activeId]))
      ) {
        this.generation += 1;
        this.resetInput();
      }
      if (previous.autoShowKeyboard !== update.autoShowKeyboard) {
        this.generation += 1;
        this.lastEditableFocus = undefined;
      }
      this.syncRuntime();
      if (toggled) ControllerDisplay.setModuleEnabled(update.enabled);
      for (const window of WindowManager.appWindows) {
        if (window && !window.isDestroyed()) {
          window.webContents.send(
            "desktop-controller-settings-changed",
            update
          );
        }
      }
      return update;
    });
    this.pendingWrite = write.then(
      () => undefined,
      () => undefined
    );
    return write;
  }

  public static getDevices() {
    return NativeAddon.listDesktopControllers();
  }

  private static mayPoll() {
    return (
      this.shouldRun &&
      this.settings.enabled &&
      !this.suspended &&
      !hasTrackedGamesRunning()
    );
  }

  private static syncRuntime() {
    if (!this.mayPoll()) {
      this.stopPolling();
      return;
    }
    if (!this.polling) this.schedule(0);
  }

  private static stopPolling() {
    if (this.polling) clearTimeout(this.polling);
    this.polling = undefined;
    this.generation += 1;
    this.resetInput();
    if (process.platform === "win32") NativeAddon.stopDesktopControllerInput();
  }

  private static resetInput() {
    this.session.reset();
    this.activeDeviceId = undefined;
    for (const button of this.mouseButtons) {
      NativeAddon.controllerDesktopAction(`${button}Up`, 0);
    }
    this.mouseButtons.clear();
    this.lastEditableFocus = undefined;
    this.lastScrollAt = 0;
    this.keyboardFocusAt = 0;
  }

  private static schedule(delay: number) {
    this.polling = setTimeout(() => {
      this.polling = undefined;
      if (!this.mayPoll()) return;
      try {
        this.schedule(this.poll());
      } catch (error) {
        logger.warn("Could not poll Windows desktop controllers", error);
        this.resetInput();
        this.schedule(noDevicePollMs);
      }
    }, delay);
    this.polling.unref();
  }

  private static poll() {
    const focused = WindowManager.bigPictureWindow?.isFocused() === true;
    if (focused !== this.bigPictureFocused) {
      this.bigPictureFocused = focused;
      this.generation += 1;
      this.resetInput();
    }

    const frames = NativeAddon.pollDesktopControllers();
    const isEnabled = (id: string) =>
      (this.settings.profiles[id] ?? defaultProfile).enabled;
    const preferred = frames.find(
      (frame) =>
        frame.id === this.settings.preferredDeviceId && isEnabled(frame.id)
    );
    const current = frames.find(
      (frame) => frame.id === this.activeDeviceId && isEnabled(frame.id)
    );
    const selected =
      preferred ?? current ?? frames.find((frame) => isEnabled(frame.id));
    if (!selected) {
      this.resetInput();
      return noDevicePollMs;
    }

    this.activeDeviceId = selected.id;
    const now = performance.now();
    const profile = this.settings.profiles[selected.id] ?? defaultProfile;
    const frame = {
      axes: selected.axes,
      buttons: Array.from({ length: 19 }, (_, index) =>
        Boolean(selected.buttons & (1 << index))
      ),
    };
    const actions = this.session.update(selected.id, frame, profile, false);
    const active = actions.length > 0 || frame.buttons.some(Boolean);
    if (active) this.lastInputAt = now;
    for (const action of actions) this.dispatch(action, now, focused);

    if (
      !focused &&
      this.settings.autoShowKeyboard &&
      now - this.keyboardFocusAt >= keyboardFocusPollMs
    ) {
      this.keyboardFocusAt = now;
      this.checkEditableFocus();
    }
    return now - this.lastInputAt < 1_000 ? activePollMs : idlePollMs;
  }

  private static dispatch(
    action: DesktopAction,
    now: number,
    bigPictureFocused: boolean
  ) {
    // These two explicitly assigned shortcuts also work in Big Picture mode.
    if (action.type === "nextDisplay") {
      void ControllerDisplay.cycleDisplay();
      return;
    }
    if (action.type === "displayMode") {
      void ControllerDisplay.cycleMode();
      return;
    }
    if (bigPictureFocused) return;

    switch (action.type) {
      case "move": {
        const x = Math.round(action.x);
        const y = Math.round(action.y);
        if (x || y) NativeAddon.moveControllerCursor(x, y);
        break;
      }
      case "mouse":
        if (action.down !== this.mouseButtons.has(action.button)) {
          const successful = NativeAddon.controllerDesktopAction(
            `${action.button}${action.down ? "Down" : "Up"}`,
            0
          );
          if (successful && action.down) this.mouseButtons.add(action.button);
          if (successful && !action.down)
            this.mouseButtons.delete(action.button);
        }
        break;
      case "scroll":
        if (now - this.lastScrollAt >= scrollRepeatMs) {
          if (action.y)
            NativeAddon.controllerDesktopAction("scroll", -Math.sign(action.y));
          if (action.x)
            NativeAddon.controllerDesktopAction(
              "horizontalScroll",
              Math.sign(action.x)
            );
          this.lastScrollAt = now;
        }
        break;
      case "keyboard":
        this.showKeyboard(now);
        break;
      default:
        NativeAddon.controllerDesktopAction(action.type, 0);
    }
  }

  private static showKeyboard(now: number) {
    if (now - this.lastKeyboardAt < 900) return;
    this.lastKeyboardAt = now;
    NativeAddon.showDesktopKeyboard();
  }

  private static checkEditableFocus() {
    if (this.keyboardFocusPending) return;
    this.keyboardFocusPending = true;
    const generation = this.generation;
    void NativeAddon.getDesktopEditableFocus()
      .then((focus) => {
        if (
          generation !== this.generation ||
          this.bigPictureFocused ||
          !this.mayPoll() ||
          !this.settings.autoShowKeyboard
        )
          return;
        if (focus && focus !== this.lastEditableFocus)
          this.showKeyboard(performance.now());
        this.lastEditableFocus = focus ?? undefined;
      })
      .finally(() => {
        this.keyboardFocusPending = false;
      });
  }
}
