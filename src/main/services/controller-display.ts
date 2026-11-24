import { db, levelKeys } from "@main/level";
import {
  defaultControllerDisplaySettings,
  readControllerDisplaySettings,
  resolveControllerTelevision,
  type ControllerDisplay as Display,
  type ControllerDisplaySettings,
} from "../../shared/controller-display";
import {
  hasTrackedGamesRunning,
  onTrackedGamesRunningChange,
} from "./game-running-state";
import { logger } from "./logger";
import { NativeAddon } from "./native-addon";

const AUDIO_RETRY_DELAYS_MS = [250, 550, 1000, 1600];

class ControllerDisplayService {
  private settings = { ...defaultControllerDisplaySettings };
  private loadPromise?: Promise<void>;
  private settingsWrite = Promise.resolve();
  private enabled = false;
  private bigPictureOpen = false;
  private lastGamesRunning = false;
  private automaticDisplayId?: string;
  private audioDisplayId?: string;
  private previousAudio?: string[];
  private audioTimer?: NodeJS.Timeout;
  private unsubscribeGames?: () => void;

  public getDisplays(): Display[] {
    return NativeAddon.getWindowsControllerDisplays();
  }

  public async getSettings(): Promise<ControllerDisplaySettings> {
    this.loadPromise ??= db
      .get<string, unknown>(levelKeys.controllerDisplaySettings, {
        valueEncoding: "json",
      })
      .then((value) => {
        this.settings = {
          ...defaultControllerDisplaySettings,
          ...readControllerDisplaySettings(value),
        };
      })
      .catch((error: unknown) => {
        this.loadPromise = undefined;
        throw error;
      });
    await this.loadPromise;
    return this.settings;
  }

  public updateSettings(value: unknown): Promise<ControllerDisplaySettings> {
    const patch = readControllerDisplaySettings(value);
    const write = this.settingsWrite.then(async () => {
      await this.getSettings();
      const previous = this.settings;
      const next = { ...previous, ...patch };
      await db.put<string, ControllerDisplaySettings>(
        levelKeys.controllerDisplaySettings,
        next,
        { valueEncoding: "json" }
      );
      this.settings = next;

      if (previous.autoSwitchToTv && !next.autoSwitchToTv) {
        this.restoreAutomaticDisplay();
      } else if (!previous.autoSwitchToTv && next.autoSwitchToTv) {
        this.prepareGameLaunch();
      }
      if (previous.switchHdmiAudio && !next.switchHdmiAudio) {
        this.restoreAudio();
      } else if (
        !previous.switchHdmiAudio &&
        next.switchHdmiAudio &&
        this.automaticDisplayId &&
        !this.audioDisplayId
      ) {
        this.setAudioForDisplay(
          this.getDisplays().find(
            (display) => display.id === this.automaticDisplayId
          )
        );
      }
      this.syncGameListener();
      return next;
    });
    this.settingsWrite = write.then(
      () => undefined,
      () => undefined
    );
    return write;
  }

  public setModuleEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.restoreAutomaticDisplay(false);
      this.restoreAudio(false);
    } else if (this.bigPictureOpen) {
      this.prepareGameLaunch();
    }
    this.syncGameListener();
  }

  public async openBigPicture(): Promise<void> {
    if (process.platform !== "win32") return;
    try {
      await this.getSettings();
      this.bigPictureOpen = true;
      this.syncGameListener();
      this.prepareGameLaunch();
    } catch (error) {
      logger.warn("Failed to load controller display preferences", error);
    }
  }

  public closeBigPicture(): void {
    this.bigPictureOpen = false;
    if (!hasTrackedGamesRunning()) this.restoreAutomaticDisplay();
    this.syncGameListener();
  }

  public prepareGameLaunch(): void {
    if (this.bigPictureOpen && !hasTrackedGamesRunning()) {
      this.activateAutomaticDisplay();
    }
  }

  public shutdown(): void {
    this.enabled = false;
    this.syncGameListener();
    this.restoreAutomaticDisplay(false);
    this.restoreAudio(false);
  }

  public handleTopologyChanged(): void {
    if (!this.automaticDisplayId && !this.audioDisplayId) return;
    const displays = this.getDisplays();
    if (
      this.automaticDisplayId &&
      !displays.some((display) => display.id === this.automaticDisplayId)
    ) {
      this.restoreAutomaticDisplay();
    } else if (
      this.audioDisplayId &&
      !displays.some(
        (display) => display.id === this.audioDisplayId && display.active
      )
    ) {
      this.restoreAudio();
    }
    this.syncGameListener();
  }

  public setDisplayMode(mode: unknown, id?: unknown): boolean {
    if (!this.enabled || hasTrackedGamesRunning()) return false;
    if (mode !== "display" && mode !== "duplicate" && mode !== "extend") {
      return false;
    }
    const displays = this.getDisplays();
    const display =
      mode === "display" && typeof id === "string"
        ? displays.find((target) => target.id === id)
        : undefined;
    if (mode === "display" ? !display : displays.length < 2) return false;

    const audioDefaults = this.captureAudioFor(display);
    if (
      !NativeAddon.switchWindowsControllerDisplay(
        mode,
        display?.id ?? "",
        false
      )
    ) {
      return false;
    }
    this.automaticDisplayId = undefined;
    this.applyAudioFor(display, audioDefaults);
    this.syncGameListener();
    return true;
  }

  public cycleDisplay(): boolean {
    const displays = this.getDisplays();
    if (displays.length < 2) return false;
    const active = displays.findIndex((display) => display.active);
    const next = displays[(active + 1) % displays.length];
    return this.setDisplayMode("display", next.id);
  }

  public cycleMode(): boolean {
    return this.setDisplayMode(
      NativeAddon.getWindowsControllerDisplayMode() === "duplicate"
        ? "extend"
        : "duplicate"
    );
  }

  private syncGameListener(): void {
    const listen =
      this.enabled &&
      process.platform === "win32" &&
      (Boolean(this.automaticDisplayId) ||
        (this.bigPictureOpen && this.settings.autoSwitchToTv));
    if (listen && !this.unsubscribeGames) {
      this.lastGamesRunning = hasTrackedGamesRunning();
      this.unsubscribeGames = onTrackedGamesRunningChange(() => {
        const running = hasTrackedGamesRunning();
        if (running === this.lastGamesRunning) return;
        this.lastGamesRunning = running;
        if (running && this.bigPictureOpen) {
          this.activateAutomaticDisplay();
        } else if (
          !running &&
          (!this.bigPictureOpen || this.settings.restoreDisplayAfterGame)
        ) {
          this.restoreAutomaticDisplay();
          this.syncGameListener();
        }
      });
    } else if (!listen && this.unsubscribeGames) {
      this.unsubscribeGames();
      this.unsubscribeGames = undefined;
    }
  }

  private activateAutomaticDisplay(): void {
    if (
      !this.enabled ||
      !this.settings.autoSwitchToTv ||
      this.automaticDisplayId
    ) {
      return;
    }
    const display = resolveControllerTelevision(
      this.getDisplays(),
      this.settings.preferredDisplayId
    );
    if (!display) return;
    const audioDefaults = this.captureAudioFor(display);
    if (
      !NativeAddon.switchWindowsControllerDisplay("display", display.id, true)
    ) {
      logger.warn(
        "Could not project Windows to the preferred Big Picture display"
      );
      return;
    }
    this.automaticDisplayId = display.id;
    this.applyAudioFor(display, audioDefaults);
  }

  private restoreAutomaticDisplay(retryAudio = true): void {
    if (!this.automaticDisplayId) return;
    if (NativeAddon.restoreWindowsControllerDisplay()) {
      this.automaticDisplayId = undefined;
    } else {
      logger.warn(
        "Could not restore the previous Windows display configuration"
      );
    }
    this.restoreAudio(retryAudio);
  }

  private captureAudioFor(display: Display | undefined): string[] {
    if (!display?.hdmi || !this.settings.switchHdmiAudio) return [];
    return (
      this.previousAudio ?? NativeAddon.getWindowsControllerAudioDefaults()
    );
  }

  private setAudioForDisplay(display: Display | undefined): void {
    this.applyAudioFor(display, this.captureAudioFor(display));
  }

  private applyAudioFor(
    display: Display | undefined,
    defaults: string[]
  ): void {
    if (
      !display?.hdmi ||
      !this.settings.switchHdmiAudio ||
      !defaults.some(Boolean)
    ) {
      this.restoreAudio();
      return;
    }
    this.previousAudio = defaults;
    this.audioDisplayId = display.id;
    this.runAudioOperation(() =>
      NativeAddon.switchWindowsControllerHdmiAudio(display.label, true)
    );
  }

  private restoreAudio(retry = true): void {
    const defaults = this.previousAudio;
    this.audioDisplayId = undefined;
    this.clearAudioTimer();
    if (!defaults) return;
    const restore = () => {
      if (!NativeAddon.restoreWindowsControllerAudioDefaults(defaults))
        return false;
      this.previousAudio = undefined;
      return true;
    };
    if (retry && this.enabled) {
      this.runAudioOperation(restore);
    } else {
      restore();
      this.previousAudio = undefined;
    }
  }

  private clearAudioTimer(): void {
    if (this.audioTimer) clearTimeout(this.audioTimer);
    this.audioTimer = undefined;
  }

  private runAudioOperation(operation: () => boolean): void {
    this.clearAudioTimer();
    const attempt = (index: number) => {
      this.audioTimer = undefined;
      if (operation()) return;
      const delay = AUDIO_RETRY_DELAYS_MS[index];
      if (delay !== undefined) {
        this.audioTimer = setTimeout(() => attempt(index + 1), delay);
        this.audioTimer.unref();
      }
    };
    attempt(0);
  }
}

export const ControllerDisplay = new ControllerDisplayService();
