import { create } from "zustand";
import { controllerProfileKey, normalizeControllerProfile, defaultControllerProfile, type ControllerProfile } from "../../../shared/controller-desktop";
import { GamepadRawState, GamepadService } from "../services";

type GamepadStateMap = Map<number, GamepadRawState>;

interface GamepadInfo {
  index: number;
  name: string;
  layout: string;
}

export interface GamepadState {
  states: Map<number, GamepadRawState>;
  connectedGamepads: GamepadInfo[];
  hasGamepadConnected: boolean;
  activeGamepadIndex: number | null;

  profiles: Record<string, ControllerProfile>;
  activeProfile: ControllerProfile;
  saveProfile: (name: string, layout: string, profile: ControllerProfile) => void;
  resetProfile: (name: string, layout: string) => void;
  sync: () => void;
  getActiveGamepad: () => GamepadInfo | null;
  getService: () => GamepadService;
}

export const useGamepadStore = create<GamepadState>((set, get) => {
  const storageKey = "krysta-controller-profiles-v1";
  let profiles: Record<string, ControllerProfile> = {};
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    if (saved && typeof saved === "object") for (const [key, value] of Object.entries(saved).slice(0, 100)) {
      if (key.startsWith("[")) profiles[key] = normalizeControllerProfile(value);
    }
  } catch { /* unavailable storage */ }
  const resolveProfile = (pad: GamepadInfo | null) => pad ? profiles[controllerProfileKey(pad.name, pad.layout)] ?? defaultControllerProfile() : defaultControllerProfile();
  const persist = () => {
    try { localStorage.setItem(storageKey, JSON.stringify(profiles)); } catch { /* session-only settings */ }
    set({ profiles, activeProfile: resolveProfile(get().getActiveGamepad()) });
  };
  let cachedConnectedGamepads: GamepadInfo[] = [];
  let isInitialized = false;

  const ensureInitialized = () => {
    if (isInitialized) return;

    isInitialized = true;

    const service = GamepadService.getInstance();
    service.onStateChange(() => {
      get().sync();
    });
  };

  return {
    profiles,
    activeProfile: defaultControllerProfile(),
    saveProfile: (name, layout, profile) => {
      profiles = { ...profiles, [controllerProfileKey(name, layout)]: normalizeControllerProfile(profile) };
      persist();
    },
    resetProfile: (name, layout) => {
      profiles = { ...profiles };
      delete profiles[controllerProfileKey(name, layout)];
      persist();
    },
    states: new Map(),
    connectedGamepads: [],
    hasGamepadConnected: false,
    activeGamepadIndex: null,

    sync: () => {
      ensureInitialized();

      const service = GamepadService.getInstance();
      const rawStates = service.getCurrentState() as GamepadStateMap;
      const hasGamepadConnected = rawStates.size > 0;
      const activeGamepadIndex = service.getActiveGamepadIndex();

      let connectedGamepads = cachedConnectedGamepads;

      if (rawStates.size !== cachedConnectedGamepads.length || cachedConnectedGamepads.some((pad) => {
        const state = rawStates.get(pad.index);
        return !state || state.name !== pad.name || state.layout !== pad.layout;
      })) {
        connectedGamepads = Array.from(rawStates.entries()).map(
          ([idx, state]) => ({
            index: idx,
            name: state.name,
            layout: state.layout,
          })
        );

        cachedConnectedGamepads = connectedGamepads;
      }

      set({
        states: rawStates,
        hasGamepadConnected,
        connectedGamepads,
        activeGamepadIndex,
        activeProfile: activeGamepadIndex === get().activeGamepadIndex ? get().activeProfile : resolveProfile(connectedGamepads.find((pad) => pad.index === activeGamepadIndex) ?? null),
      });
    },

    getActiveGamepad: () => {
      const activeGamepadIndex = get().activeGamepadIndex;

      if (activeGamepadIndex === null) return null;

      const state = get().states.get(activeGamepadIndex);
      if (!state) return null;

      return {
        index: activeGamepadIndex,
        name: state.name,
        layout: state.layout,
      };
    },

    getService: () => GamepadService.getInstance(),
  };
});
