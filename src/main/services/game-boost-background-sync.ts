import {
  hasTrackedGamesRunning,
  onTrackedGamesRunningChange,
} from "./game-running-state.js";
import { getGameBoostPreferences } from "../../shared/game-boost-preferences.js";
import type { UserPreferences } from "@types";

let pauseDuringGame = true;
const listeners = new Set<() => void>();
let paused = pauseDuringGame && hasTrackedGamesRunning();

const updatePause = () => {
  const nextPaused = pauseDuringGame && hasTrackedGamesRunning();
  if (paused === nextPaused) return;
  paused = nextPaused;
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      // A failing consumer must not prevent other deferred tasks from resuming.
      console.warn("[Game Boost] Background sync listener failed", error);
    }
  }
};

onTrackedGamesRunningChange(updatePause);

export const syncGameBoostBackgroundSyncPreferences = (
  preferences: UserPreferences | null
) => {
  const { enabled, pauseBackgroundSync } = getGameBoostPreferences(preferences);
  pauseDuringGame = enabled && pauseBackgroundSync;
  updatePause();
};

export const isGameBoostBackgroundSyncPaused = () => paused;

export const onGameBoostBackgroundSyncChange = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export async function waitForGameBoostBackgroundSync(signal?: AbortSignal) {
  signal?.throwIfAborted();
  while (isGameBoostBackgroundSyncPaused()) {
    await new Promise<void>((resolve) => {
      const resume = () => {
        unsubscribe();
        signal?.removeEventListener("abort", resume);
        resolve();
      };
      const unsubscribe = onGameBoostBackgroundSyncChange(() => {
        if (!isGameBoostBackgroundSyncPaused()) resume();
      });
      signal?.addEventListener("abort", resume, { once: true });
    });
    signal?.throwIfAborted();
  }
}
