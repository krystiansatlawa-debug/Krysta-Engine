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
  requestFullscreen: (
    window: TrackedGameWindow,
    currentMode: Exclude<GameDisplayMode, "exclusive">
  ) => boolean;
};

export class XboxGuideWindowToggle {
  private minimized: {
    window: TrackedGameWindow;
    mode: GameDisplayMode | null;
  } | null = null;
  private wasPressed: boolean | undefined;
  private busy = false;
  private generation = 0;

  constructor(private readonly windows: GameWindowActions) {}

  reset() {
    this.generation++;
    this.wasPressed = undefined;
    this.minimized = null;
  }

  private async restoreDisplayMode(
    window: TrackedGameWindow,
    before: GameDisplayMode | null,
    generation: number
  ) {
    if (!before || before === "windowed") return;

    // Let the game reacquire its output after the asynchronous Win32 restore.
    await delay(400);
    let observed: GameDisplayMode | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      if (this.generation !== generation) return;
      const mode = this.windows.getDisplayMode(window);
      if (
        mode === "exclusive" ||
        (mode === "fullscreen" && before === "fullscreen")
      )
        return;
      if (!mode && observed) return;
      if (mode && mode === observed) {
        this.windows.requestFullscreen(window, mode);
        return;
      }
      observed = mode;
      await delay(100);
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
        const tracked = await this.windows.isTrackedGame(
          minimized.window.gameKey
        );
        if (this.generation !== generation) return;
        this.minimized = null;
        if (tracked && this.windows.restore(minimized.window)) {
          await this.restoreDisplayMode(
            minimized.window,
            minimized.mode,
            generation
          );
          return;
        }
      }
      const active = await this.windows.findForegroundGame();
      if (this.generation !== generation || !active) return;
      const mode = this.windows.getDisplayMode(active);
      if (this.windows.minimize(active))
        this.minimized = { window: active, mode };
    } finally {
      this.busy = false;
    }
  }
}
