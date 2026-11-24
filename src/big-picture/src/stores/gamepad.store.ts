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

  preferredGamepadIndex: number | null;
  selectGamepad: (index: number | null) => void;
  playFeedback: (effect: "navigation" | "confirm" | "notification") => void;
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
  // Browser Gamepad API exposes a slot, not a hardware serial number.
  const slotKey = (pad: GamepadInfo) => JSON.stringify([controllerProfileKey(pad.name, pad.layout), pad.index]);
  const resolveProfile = (pad: GamepadInfo | null) => pad ? profiles[slotKey(pad)] ?? profiles[controllerProfileKey(pad.name, pad.layout)] ?? defaultControllerProfile() : defaultControllerProfile();
  const editKey = (name: string, layout: string) => {
    const pad = get().getActiveGamepad();
    return pad && pad.name === name && pad.layout === layout ? slotKey(pad) : controllerProfileKey(name, layout);
  };
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
    playFeedback: (effect) => {
      const state = get();
      if (!state.activeProfile.vibration || state.activeGamepadIndex === null) return;
      const patterns = { navigation: [35, 0.12, 0.04], confirm: [85, 0.25, 0.55], notification: [180, 0.6, 0.25] } as const;
      const [duration, weak, strong] = patterns[effect];
      state.getService().vibrate(duration, weak, strong, state.activeGamepadIndex);
    },
    preferredGamepadIndex: null,
    selectGamepad: (index) => {
      if (index !== null && !get().connectedGamepads.some((pad) => pad.index === index)) return;
      GamepadService.getInstance().setPreferredGamepadIndex(index);
      get().sync();
    },
    profiles,
    activeProfile: defaultControllerProfile(),
    saveProfile: (name, layout, profile) => {
      profiles = { ...profiles, [editKey(name, layout)]: normalizeControllerProfile(profile) };
      persist();
    },
    resetProfile: (name, layout) => {
      profiles = { ...profiles };
      profiles[editKey(name, layout)] = defaultControllerProfile();
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
        preferredGamepadIndex: service.getPreferredGamepadIndex(),
        activeProfile: activeGamepadIndex === get().activeGamepadIndex && connectedGamepads === get().connectedGamepads ? get().activeProfile : resolveProfile(connectedGamepads.find((pad) => pad.index === activeGamepadIndex) ?? null),
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
