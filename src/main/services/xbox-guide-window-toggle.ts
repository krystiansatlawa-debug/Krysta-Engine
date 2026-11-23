import { setTimeout as delay } from "node:timers/promises";

export type TrackedGameWindow = {
  gameKey: string;
  handle: string;
  processId: number;
};

type GameWindowActions = {
  findForegroundGame: () => Promise<TrackedGameWindow | null>;
  isTrackedGame: (gameKey: string) => Promise<boolean>;
  minimize: (window: TrackedGameWindow) => boolean;
  restore: (window: TrackedGameWindow) => boolean;
  fullscreen: (window: TrackedGameWindow) => boolean;
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
          // Windows restores and resizes the game on its own window thread.
          for (let attempt = 0; attempt < 8; attempt++) {
            await delay(75);
            if (this.generation !== generation) return;
            if (this.windows.fullscreen(minimized)) return;
          }
          return;
        }
      }
      const active = await this.windows.findForegroundGame();
      if (
        this.generation === generation &&
        active &&
        this.windows.minimize(active)
      ) {
        this.minimized = active;
      }
    } finally {
      this.busy = false;
    }
  }
}
