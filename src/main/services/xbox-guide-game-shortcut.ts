import { app } from "electron";
import type { UserPreferences } from "@types";
import {
  hasTrackedGamesRunning,
  onTrackedGamesRunningChange,
} from "./game-running-state";
import { logger } from "./logger";
import { NativeAddon } from "./native-addon";
import {
  getScreenshotGameTargets,
  resolveForegroundGame,
} from "./screenshots/foreground-game";
import { XboxGuideWindowToggle } from "./xbox-guide-window-toggle";

const shortcut = new XboxGuideWindowToggle({
  async findForegroundGame() {
    const resolved = await resolveForegroundGame("deeplink");
    if (resolved.status !== "resolved" || !resolved.game) return null;
    const foreground = resolved.foreground;
    if (!foreground?.windowHandle || !foreground.processId) return null;

    return {
      gameKey: resolved.target.gameKey,
      handle: foreground.windowHandle,
      processId: foreground.processId,
    };
  },
  async isTrackedGame(key) {
    const games = await getScreenshotGameTargets();
    return games.some(({ target }) => target.gameKey === key);
  },
  minimize: ({ handle, processId }) =>
    NativeAddon.setWindowsGameWindowMinimized(handle, processId, true),
  restore: ({ handle, processId }) =>
    NativeAddon.setWindowsGameWindowMinimized(handle, processId, false),
  getDisplayMode: ({ handle, processId }) =>
    NativeAddon.getWindowsGameDisplayMode(handle, processId),
  requestFullscreen: ({ handle, processId }) =>
    NativeAddon.requestWindowsGameFullscreen(handle, processId),
  fillScreen: ({ handle, processId }) =>
    NativeAddon.fillWindowsGameScreen(handle, processId),
});

let enabled = false;
let timer: ReturnType<typeof setInterval> | undefined;

function stop() {
  if (timer) clearInterval(timer);
  timer = undefined;
  shortcut.reset();
}

function reconcile() {
  if (!enabled || !hasTrackedGamesRunning()) {
    stop();
    return;
  }

  if (timer) return;
  timer = setInterval(() => {
    const pressed = NativeAddon.getWindowsXboxGuidePressed();
    if (pressed === null) {
      stop();
      return;
    }
    void shortcut
      .sample(pressed)
      .catch((error) => logger.warn("Xbox Guide game shortcut failed", error));
  }, 32);
  timer.unref();
}

export function syncXboxGuideGameShortcut(
  preferences: UserPreferences | null | undefined
) {
  if (process.platform !== "win32") return;
  enabled = preferences?.xboxGuideGameShortcutEnabled === true;
  reconcile();
}

if (process.platform === "win32") {
  const unsubscribe = onTrackedGamesRunningChange(reconcile);
  app.once("before-quit", () => {
    enabled = false;
    unsubscribe();
    stop();
  });
}
