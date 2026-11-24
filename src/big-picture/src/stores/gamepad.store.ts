import { create } from "zustand";
import {
  controllerProfileKey,
  defaultControllerProfile,
  normalizeControllerProfile,
  type ControllerProfile,
} from "../../../shared/controller-desktop";
import {
  GamepadService,
  type GamepadRawState,
} from "../services/gamepad.service";

type GamepadStateMap = Map<number, GamepadRawState>;
type BrowserProfiles = Record<string, ControllerProfile>;

const PROFILES_STORAGE_KEY = "krysta-controller-profiles-v1";
const ACTIVE_PAD_STORAGE_KEY = "krysta-controller-active-browser-pad-v1";

export interface GamepadInfo {
  index: number;
  name: string;
  layout: string;
  buttonCount: number;
}

function slotProfileKey(pad: GamepadInfo): string {
  return JSON.stringify([
    controllerProfileKey(pad.name, pad.layout),
    pad.index,
  ]);
}

function readProfiles(): BrowserProfiles | null {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem(PROFILES_STORAGE_KEY) ?? "{}"
    );
    if (!saved || typeof saved !== "object") return {};

    return Object.fromEntries(
      Object.entries(saved)
        .filter(([key]) => key.startsWith("["))
        .map(([key, value]) => [key, normalizeControllerProfile(value)])
    );
  } catch {
    return null;
  }
}

function readPreferredPad(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PAD_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getBrowserControllerProfile(
  profiles: BrowserProfiles,
  pad: GamepadInfo | null
): ControllerProfile {
  return (
    (pad &&
      (profiles[slotProfileKey(pad)] ??
        profiles[controllerProfileKey(pad.name, pad.layout)])) ||
    defaultControllerProfile()
  );
}

export interface GamepadState {
  states: GamepadStateMap;
  connectedGamepads: GamepadInfo[];
  hasGamepadConnected: boolean;
  activeGamepadIndex: number | null;
  preferredGamepadIndex: number | null;
  selectGamepad: (index: number | null) => void;
  playFeedback: (effect: "navigation" | "confirm" | "notification") => void;
  profiles: BrowserProfiles;
  activeProfile: ControllerProfile;
  updateProfile: (pad: GamepadInfo, patch: Partial<ControllerProfile>) => void;
  resetProfile: (pad: GamepadInfo) => void;
  sync: () => void;
  getActiveGamepad: () => GamepadInfo | null;
  getService: () => GamepadService;
}

export const useGamepadStore = create<GamepadState>((set, get) => {
  let profiles = readProfiles() ?? {};
  let preferredPad = readPreferredPad();
  let cachedConnectedGamepads: GamepadInfo[] = [];
  let isInitialized = false;

  const refreshProfiles = (next: BrowserProfiles) => {
    profiles = next;
    set({
      profiles,
      activeProfile: getBrowserControllerProfile(
        profiles,
        get().getActiveGamepad()
      ),
    });
  };

  const persistProfile = (
    pad: GamepadInfo,
    patch: Partial<ControllerProfile>,
    reset = false
  ) => {
    const latest = readProfiles() ?? profiles;
    const profile = reset
      ? defaultControllerProfile()
      : normalizeControllerProfile({
          ...getBrowserControllerProfile(latest, pad),
          ...patch,
        });
    const next = { ...latest, [slotProfileKey(pad)]: profile };

    try {
      localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Keep the profile available for this session.
    }
    refreshProfiles(next);
  };

  const ensureInitialized = () => {
    if (isInitialized) return;

    isInitialized = true;

    GamepadService.getInstance().onStateChange(() => {
      get().sync();
    });
    globalThis.window?.addEventListener("storage", (event) => {
      if (event.key === PROFILES_STORAGE_KEY || event.key === null) {
        refreshProfiles(readProfiles() ?? {});
      }
      if (event.key === ACTIVE_PAD_STORAGE_KEY || event.key === null) {
        preferredPad = readPreferredPad();
        get().sync();
      }
    });
  };

  return {
    playFeedback: (effect) => {
      const state = get();
      if (!state.activeProfile.vibration || state.activeGamepadIndex === null)
        return;

      const patterns = {
        navigation: [35, 0.12, 0.04],
        confirm: [85, 0.25, 0.55],
        notification: [180, 0.6, 0.25],
      } as const;
      const [duration, weak, strong] = patterns[effect];
      state
        .getService()
        .vibrate(duration, weak, strong, state.activeGamepadIndex);
    },
    preferredGamepadIndex: null,
    selectGamepad: (index) => {
      const pad = get().connectedGamepads.find(
        (entry) => entry.index === index
      );
      if (index !== null && !pad) return;

      preferredPad = pad ? slotProfileKey(pad) : null;
      try {
        if (preferredPad === null) {
          localStorage.removeItem(ACTIVE_PAD_STORAGE_KEY);
        } else {
          localStorage.setItem(ACTIVE_PAD_STORAGE_KEY, preferredPad);
        }
      } catch {
        // Keep the selection available for this session.
      }
      get().sync();
    },
    profiles,
    activeProfile: defaultControllerProfile(),
    updateProfile: (pad, patch) => persistProfile(pad, patch),
    resetProfile: (pad) => persistProfile(pad, {}, true),
    states: new Map(),
    connectedGamepads: [],
    hasGamepadConnected: false,
    activeGamepadIndex: null,

    sync: () => {
      ensureInitialized();

      const service = GamepadService.getInstance();
      const currentState = service.getCurrentState();
      const rawStates: GamepadStateMap = currentState instanceof Map ? currentState : new Map();
      const hasGamepadConnected = rawStates.size > 0;
      let connectedGamepads = cachedConnectedGamepads;

      if (
        rawStates.size !== cachedConnectedGamepads.length ||
        cachedConnectedGamepads.some((pad) => {
          const state = rawStates.get(pad.index);
          return (
            !state || state.name !== pad.name || state.layout !== pad.layout
          );
        })
      ) {
        const gamepads = globalThis.navigator?.getGamepads?.() ?? [];
        connectedGamepads = Array.from(rawStates, ([index, state]) => ({
          index,
          name: state.name,
          layout: state.layout,
          buttonCount: gamepads[index]?.buttons.length ?? 17,
        }));
        cachedConnectedGamepads = connectedGamepads;
      }

      const preferredGamepadIndex =
        connectedGamepads.find((pad) => slotProfileKey(pad) === preferredPad)
          ?.index ?? null;
      if (preferredGamepadIndex !== service.getPreferredGamepadIndex()) {
        service.setPreferredGamepadIndex(preferredGamepadIndex);
      }

      const activeGamepadIndex = service.getActiveGamepadIndex();
      set({
        states: rawStates,
        hasGamepadConnected,
        connectedGamepads,
        activeGamepadIndex,
        preferredGamepadIndex,
        activeProfile:
          activeGamepadIndex === get().activeGamepadIndex &&
          connectedGamepads === get().connectedGamepads
            ? get().activeProfile
            : getBrowserControllerProfile(
                profiles,
                connectedGamepads.find(
                  (pad) => pad.index === activeGamepadIndex
                ) ?? null
              ),
      });
    },

    getActiveGamepad: () =>
      get().connectedGamepads.find(
        (pad) => pad.index === get().activeGamepadIndex
      ) ?? null,

    getService: () => GamepadService.getInstance(),
  };
});
