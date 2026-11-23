import { setTimeout as delay } from "node:timers/promises";

export type TrackedGameWindow = {
  gameKey: string;
  handle: string;
  processId: number;
};

export type GameDisplayMode = "windowed" | "fullscreen" | "exclusive";

type GameWindowActions = {
  findForegroundGame: () => Promise<TrackedGameWindow | null>;
  isTrackedGame: (gameKey: string) => Promise<boolean>;
  minimize: (window: TrackedGameWindow) => boolean;
  restore: (window: TrackedGameWindow) => boolean;
  getDisplayMode: (window: TrackedGameWindow) => GameDisplayMode | null;
  requestFullscreen: (window: TrackedGameWindow) => boolean;
  fillScreen: (window: TrackedGameWindow) => void;
};

export class XboxGuideWindowToggle {
  private minimized: TrackedGameWindow | null = null;
  private wasPressed: boolean | undefined;
  private busy = false;
  private generation = 0;

  constructor(private readonly windows: GameWindowActions) {}

  reset() {
    this.generation++;
    this.wasPressed = undefined;
    this.minimized = null;
  }

  private async restoreFullscreen(
    window: TrackedGameWindow,
    generation: number
  ) {
    let focused = false;
    let fallbackAfter: number | null = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      await delay(75);
      if (this.generation !== generation) return;
      const mode = this.windows.getDisplayMode(window);
      if (!mode) {
        if (focused) return;
        continue;
      }
      if (mode !== "windowed") return;
      if (!focused) {
        focused = true;
        continue;
      }
      if (fallbackAfter === null) {
        // Give the game a moment to apply its own fullscreen shortcut.
        fallbackAfter = this.windows.requestFullscreen(window)
          ? attempt + 5
          : attempt;
      }
      if (attempt >= fallbackAfter) this.windows.fillScreen(window);
    }
  }

  async sample(pressed: boolean) {
    const pressedNow = this.wasPressed === false && pressed;
    this.wasPressed = pressed;
    if (!pressedNow || this.busy) return;

    this.busy = true;
    const generation = this.generation;
    try {
      const minimized = this.minimized;
      if (minimized) {
        const tracked = await this.windows.isTrackedGame(minimized.gameKey);
        if (this.generation !== generation) return;
        this.minimized = null;
        if (tracked && this.windows.restore(minimized)) {
          await this.restoreFullscreen(minimized, generation);
          return;
        }
      }
      const active = await this.windows.findForegroundGame();
      if (this.generation !== generation || !active) return;
      if (this.windows.minimize(active)) this.minimized = active;
    } finally {
      this.busy = false;
    }
  }
}
