import { ArrowLeftIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";

import cn from "classnames";
import { AnimatePresence, motion } from "framer-motion";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { FocusItem, HorizontalFocusGroup, Typography } from "../../components";
import { IS_DESKTOP } from "../../constants";
import { useNavigationScreenActions } from "../../hooks";
import type { FocusOverrides } from "../../services";
import {
  useNavigationHistoryStore,
  useGamepadStore,
  useNavigationStore,
  useVirtualKeyboardStore,
} from "../../stores";
import {
  BIG_PICTURE_HEADER_REGION_ID,
  normalizeBigPicturePathname,
} from "../navigation";
import "./styles.scss";

const HEADER_BACK_BUTTON_ID = "header-back-button";
const HEADER_SEARCH_INPUT_ID = "header-search-input";
const MAX_SEARCH_LENGTH = 255;
const VIRTUAL_KEYBOARD_DISMISS_EVENT = "big-picture-virtual-keyboard-dismiss";
const VIRTUAL_KEYBOARD_KEY_FOCUS_ID_PREFIX =
  "big-picture-virtual-keyboard-key-";

const useCurrentPageTitle = () => {
  const stack = useNavigationHistoryStore((s) => s.stack);
  if (stack.length >= 1) return stack[stack.length - 1].title;
  return "Home";
};

function Header() {
  const navigate = useNavigate();
  const connectedPads = useGamepadStore((state) => state.connectedGamepads);
  const preferredPad = useGamepadStore((state) => state.preferredGamepadIndex);
  const selectPad = useGamepadStore((state) => state.selectGamepad);
  const profile = useGamepadStore((state) => state.activeProfile);
  const saveProfile = useGamepadStore((state) => state.saveProfile);
  const resetProfile = useGamepadStore((state) => state.resetProfile);
  const activePadIndex = useGamepadStore((state) => state.activeGamepadIndex);
  const activePad = connectedPads.find((pad) => pad.index === activePadIndex);
  useEffect(() => {
    if (!profile.enabled || activePadIndex === null) return;
    let pending = false;
    let armed = false;
    let previous: boolean[] = [];
    let lastScroll = 0;
    const timer = window.setInterval(() => {
      if (pending) return;
      if (!document.hasFocus()) { if (armed) void window.electron.controllerPointerAction("releaseAll", 0).catch(() => undefined); armed = false; return; }
      const pad = navigator.getGamepads()[activePadIndex];
      if (!pad?.connected) { if (armed) void window.electron.controllerPointerAction("releaseAll", 0).catch(() => undefined); armed = false; return; }
      const x = pad.axes[0] ?? 0, y = pad.axes[1] ?? 0;
      const buttons = Array.from(pad.buttons, (button) => button.pressed);
      const rx = pad.axes[2] ?? 0, ry = pad.axes[3] ?? 0;
      if (!armed) { armed = [x,y,rx,ry].every(v => Math.abs(v) <= profile.deadZone) && !buttons.some(Boolean); previous = buttons; return; }
      const pressed = (index: number) => buttons[index] && !previous[index];
      const actions: [string, number][] = [];
      for (const [side, index] of [["left", profile.bindings.left ?? 0], ["right", profile.bindings.right ?? 1]] as const) {
        if (Boolean(buttons[index]) !== Boolean(previous[index])) actions.push([side + (buttons[index] ? "Down" : "Up"), 0]);
      }
      for (const [action, index] of [["volumeDown",4],["volumeUp",5],["switchWindow",3],["minimize",13],["maximize",12]] as const) {
        if (pressed(profile.bindings[action] ?? index)) actions.push([action, 0]);
      }
      if (pressed(profile.bindings.doubleClick ?? 2)) actions.push(["doubleClick", 0]);
      previous = buttons;
      if (Date.now() - lastScroll >= 100) {
        if (Math.abs(ry) > profile.deadZone) actions.push(["scroll", -Math.sign(ry)]);
        if (Math.abs(rx) > profile.deadZone) actions.push(["horizontalScroll", Math.sign(rx)]);
        lastScroll = Date.now();
      }
      const axis = (v: number) => Math.abs(v) <= profile.deadZone ? 0 : Math.round(v * profile.cursorSpeed);
      const dx = axis(x), dy = axis(y);
      if (!dx && !dy && !actions.length) return;
      pending = true;
      void Promise.all([...(dx || dy ? [window.electron.moveControllerCursor(dx, dy)] : []), ...actions.map(([action, value]) => window.electron.controllerPointerAction(action, value))]).then((results) => { if (results.some(ok => !ok)) armed = false; }).catch(() => { armed = false; }).finally(() => { pending = false; });
    }, 32);
    return () => { window.clearInterval(timer); void window.electron.controllerPointerAction("releaseAll", 0).catch(() => undefined); };
  }, [activePadIndex, profile.enabled, profile.cursorSpeed, profile.deadZone, profile.bindings]);
  const [battery, setBattery] = useState<string[]>([]);
  const padIdentity = connectedPads.map((pad) => `${pad.index}:${pad.name}:${pad.layout}`).join("|");
  const hasXbox = connectedPads.some((pad) => /xbox|xinput/i.test(`${pad.name} ${pad.layout}`));
  const hasSony = connectedPads.some((pad) => /dualsense|dualshock|playstation|sony/i.test(`${pad.name} ${pad.layout}`));
  useEffect(() => {
    setBattery([]);
    if (!IS_DESKTOP || (!hasXbox && !hasSony)) return;
    let cancelled = false;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const [xbox, sony] = await Promise.all([
          hasXbox ? window.electron.getWindowsXboxBatteryLevels().catch(() => []) : Promise.resolve([]),
          hasSony ? window.electron.getWindowsSonyBatteryLevels().catch(() => []) : Promise.resolve([]),
        ]);
        const labels: Record<string, string> = { wired: "Przewodowy", empty: "Rozładowana", low: "Niska", medium: "Średnia", full: "Pełna" };
        const rows = xbox.flatMap((level, index) => level && labels[level] ? [`Xbox ${index + 1}: ${labels[level]}`] : []);
        const seen = new Set<string>();
        for (const device of sony) {
          if (!device.id || seen.has(device.id) || !Number.isFinite(device.percent) || device.percent < 0 || device.percent > 100) continue;
          seen.add(device.id);
          rows.push(`${device.name || "PlayStation"}: ${device.percent}%${device.charging ? " ⚡ Ładowanie" : device.percent <= 20 ? " · Niska bateria" : ""}`);
        }
        if (!cancelled) setBattery(rows);
      } finally { pending = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [hasXbox, hasSony, padIdentity]);
  const batteryLabel = battery.length ? battery.join(" · ") : "Niedostępna";
  const { pathname } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const pageTitle = useCurrentPageTitle();
  const isOnCataloguePage =
    normalizeBigPicturePathname(pathname) === "/catalogue";
  const catalogueSearchValue = searchParams.get("title") ?? "";
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSearchInputFocused, setIsSearchInputFocused] = useState(false);
  const [searchValue, setSearchValue] = useState(() =>
    isOnCataloguePage ? catalogueSearchValue : ""
  );
  const currentFocusId = useNavigationStore((state) => state.currentFocusId);
  const virtualKeyboardTarget = useVirtualKeyboardStore(
    (state) => state.target
  );
  const closeVirtualKeyboard = useVirtualKeyboardStore(
    (state) => state.closeKeyboard
  );
  const isSearchFocused = currentFocusId === HEADER_SEARCH_INPUT_ID;
  const canAutoOpenSearchRef = useRef(
    currentFocusId !== null && currentFocusId !== HEADER_SEARCH_INPUT_ID
  );
  const isSearchDismissedWhileFocusedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLFormElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const searchNavigationOverrides: FocusOverrides = {
    left: {
      type: "item",
      itemId: HEADER_BACK_BUTTON_ID,
    },
  };
  const isSearchVirtualKeyboardTarget =
    virtualKeyboardTarget !== null &&
    virtualKeyboardTarget === inputRef.current;

  const openSearch = useCallback(() => {
    isSearchDismissedWhileFocusedRef.current = false;
    setIsSearchOpen(true);
    inputRef.current?.focus();
  }, []);

  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
    inputRef.current?.blur();
  }, []);

  const dismissSearch = useCallback(
    ({ closeKeyboard = false }: { closeKeyboard?: boolean } = {}) => {
      if (closeKeyboard && isSearchVirtualKeyboardTarget) {
        closeVirtualKeyboard?.({ restoreFocus: false });
      }

      isSearchDismissedWhileFocusedRef.current = true;
      closeSearch();
    },
    [closeSearch, closeVirtualKeyboard, isSearchVirtualKeyboardTarget]
  );

  const closeSearchKeepingFocus = useCallback(() => {
    dismissSearch({ closeKeyboard: true });

    globalThis.window.requestAnimationFrame(() => {
      searchTriggerRef.current?.focus({ preventScroll: true });
    });
  }, [dismissSearch]);

  const updateCatalogueTitle = useCallback(
    (value: string) => {
      setSearchParams(
        (currentSearchParams) => {
          const nextSearchParams = new URLSearchParams(currentSearchParams);

          if (value.trim()) {
            nextSearchParams.set("title", value);
          } else {
            nextSearchParams.delete("title");
          }

          return nextSearchParams;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const handleSearchChange = (value: string) => {
    const nextValue = value.slice(0, MAX_SEARCH_LENGTH);

    setSearchValue(nextValue);

    if (isOnCataloguePage) {
      updateCatalogueTitle(nextValue);
      return;
    }

    if (nextValue.trim()) {
      const nextSearchParams = new URLSearchParams({ title: nextValue });
      const basePath = IS_DESKTOP ? "/big-picture" : "";

      navigate(`${basePath}/catalogue?${nextSearchParams.toString()}`);
    }
  };

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isOnCataloguePage) {
      dismissSearch();
      return;
    }

    if (!searchValue.trim()) {
      return;
    }

    const nextSearchParams = new URLSearchParams({ title: searchValue });
    const basePath = IS_DESKTOP ? "/big-picture" : "";

    dismissSearch();
    navigate(`${basePath}/catalogue?${nextSearchParams.toString()}`);
  };

  useEffect(() => {
    if (isSearchOpen) {
      inputRef.current?.focus();
    }
  }, [isSearchOpen]);

  useEffect(() => {
    const isInputHoldingDomFocus =
      globalThis.document.activeElement === inputRef.current;

    if (
      !isSearchFocused &&
      !isSearchVirtualKeyboardTarget &&
      !isInputHoldingDomFocus
    ) {
      if (currentFocusId !== null) {
        canAutoOpenSearchRef.current = true;
      }

      const isFocusStillInsideVirtualKeyboard =
        currentFocusId?.startsWith(VIRTUAL_KEYBOARD_KEY_FOCUS_ID_PREFIX) ??
        false;

      if (currentFocusId !== null && !isFocusStillInsideVirtualKeyboard) {
        isSearchDismissedWhileFocusedRef.current = false;
      }

      if (isSearchOpen) {
        setIsSearchOpen(false);
        inputRef.current?.blur();
      }

      return;
    }

    if (isSearchVirtualKeyboardTarget) {
      return;
    }

    if (
      canAutoOpenSearchRef.current &&
      !isSearchOpen &&
      !isSearchDismissedWhileFocusedRef.current
    ) {
      openSearch();
    }
  }, [
    currentFocusId,
    isSearchFocused,
    isSearchInputFocused,
    isSearchOpen,
    isSearchVirtualKeyboardTarget,
    openSearch,
  ]);

  useEffect(() => {
    if (isOnCataloguePage) {
      setSearchValue(catalogueSearchValue);
    }
  }, [catalogueSearchValue, isOnCataloguePage]);

  useEffect(() => {
    const handleVirtualKeyboardDismiss = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      if (event.detail?.target !== inputRef.current) return;

      isSearchDismissedWhileFocusedRef.current = true;
      closeSearch();
    };

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const isVirtualKeyboardClick = Boolean(
        target?.closest(".virtual-keyboard")
      );

      if (isVirtualKeyboardClick && isSearchVirtualKeyboardTarget) {
        return;
      }

      if (isSearchOpen && !searchRef.current?.contains(e.target as Node)) {
        dismissSearch({ closeKeyboard: true });
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isSearchOpen) {
        closeSearchKeepingFocus();
      }
    };

    globalThis.window.addEventListener(
      VIRTUAL_KEYBOARD_DISMISS_EVENT,
      handleVirtualKeyboardDismiss
    );
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      globalThis.window.removeEventListener(
        VIRTUAL_KEYBOARD_DISMISS_EVENT,
        handleVirtualKeyboardDismiss
      );
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [
    closeSearch,
    closeSearchKeepingFocus,
    dismissSearch,
    isSearchOpen,
    isSearchVirtualKeyboardTarget,
  ]);

  useNavigationScreenActions(
    isSearchOpen
      ? {
          press: {
            b: closeSearchKeepingFocus,
          },
        }
      : {}
  );

  return (
    <div className="header">
      <HorizontalFocusGroup regionId={BIG_PICTURE_HEADER_REGION_ID} asChild>
        <header className="header__container">
          <FocusItem id={HEADER_BACK_BUTTON_ID} asChild>
            <button className="header__action" onClick={() => navigate(-1)}>
              <ArrowLeftIcon size={24} weight="bold" />
              <Typography variant="label" className="header__title">
                {pageTitle}
              </Typography>
            </button>
          </FocusItem>

          {connectedPads.length > 0 && <details style={{ position: "relative" }}><summary>Kontrolery</summary><div style={{ position: "absolute", zIndex: 100, background: "#20232a", padding: 12, minWidth: 220 }}><label>Aktywny pad <select value={preferredPad ?? ""} onChange={(event) => selectPad(event.target.value === "" ? null : Number(event.target.value))}><option value="">Automatycznie</option>{connectedPads.map((pad) => <option key={pad.index} value={pad.index}>{pad.name}</option>)}</select></label>{activePad && <><label style={{ display: "block" }}><input type="checkbox" checked={profile.vibration} onChange={(event) => saveProfile(activePad.name, activePad.layout, { ...profile, vibration: event.target.checked })} /> Wibracje</label><label style={{ display: "block" }}><input type="checkbox" checked={profile.enabled} onChange={(event) => saveProfile(activePad.name, activePad.layout, { ...profile, enabled: event.target.checked })} /> Sterowanie kursorem</label><label style={{ display: "block" }}>Szybkość kursora: {profile.cursorSpeed}<input type="range" min={1} max={40} value={profile.cursorSpeed} onChange={(event) => saveProfile(activePad.name, activePad.layout, { ...profile, cursorSpeed: Number(event.target.value) })} /></label><label style={{ display: "block" }}>Martwa strefa: {Math.round(profile.deadZone * 100)}%<input type="range" min={0} max={90} value={Math.round(profile.deadZone * 100)} onChange={(event) => saveProfile(activePad.name, activePad.layout, { ...profile, deadZone: Number(event.target.value) / 100 })} /></label><fieldset><legend>Przypisania przycisków</legend>{([["left","Lewe kliknięcie",0],["right","Prawe kliknięcie",1],["doubleClick","Podwójne kliknięcie",2],["switchWindow","Przełącz okno",3],["volumeDown","Ciszej",4],["volumeUp","Głośniej",5],["minimize","Minimalizuj",13],["maximize","Maksymalizuj",12]] as const).map(([action,label,fallback]) => <label key={action} style={{display:"block"}}>{label}<select value={profile.bindings[action] ?? fallback} onChange={event => saveProfile(activePad.name, activePad.layout, {...profile, bindings:{...profile.bindings,[action]:Number(event.target.value)}})}>{Array.from({length: navigator.getGamepads()[activePad.index]?.buttons.length ?? 17},(_,i)=><option key={i} value={i}>{["A / ✕","B / ○","X / □","Y / △","LB / L1","RB / R1","LT / L2","RT / R2","Back","Start","L3","R3","↑","↓","←","→","Home"][i] ?? ("Przycisk "+(i+1))}</option>)}</select></label>)}</fieldset><button type="button" onClick={() => resetProfile(activePad.name, activePad.layout)}>Przywróć domyślne</button><button type="button" disabled={!profile.vibration} onClick={() => useGamepadStore.getState().getService().vibrate(180, 0.4, 0.4, activePad.index)}>Sprawdź wibracje</button></>}</div></details>}
          {connectedPads.length > 0 && <span className="header__controller-battery" title="Poziom baterii kontrolera">🔋 {batteryLabel}</span>}
          <form
            ref={searchRef}
            role="search"
            className={cn("header__search", {
              "header__search--open": isSearchOpen,
            })}
            onSubmit={handleSearchSubmit}
          >
            <AnimatePresence initial={false}>
              {isSearchOpen || isHovered ? (
                <motion.div
                  key="left"
                  initial={{ x: 24, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: 24, opacity: 0 }}
                  transition={{
                    duration: 0.2,
                    ease: "easeInOut",
                    delay: 0.1,
                  }}
                  className="header__search-icon header__search-icon--left"
                >
                  <MagnifyingGlassIcon size={24} />
                </motion.div>
              ) : (
                <motion.div
                  key="right"
                  initial={{ x: -24, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: -24, opacity: 0 }}
                  transition={{
                    duration: 0.2,
                    ease: "easeInOut",
                    delay: 0.1,
                  }}
                  className="header__search-icon header__search-icon--right"
                >
                  <MagnifyingGlassIcon size={24} />
                </motion.div>
              )}
            </AnimatePresence>

            <FocusItem
              id={HEADER_SEARCH_INPUT_ID}
              actions={{ primary: openSearch }}
              navigationOverrides={searchNavigationOverrides}
              asChild
            >
              <button
                ref={searchTriggerRef}
                type="button"
                aria-label="Search catalogue"
                className="header__search-trigger"
                onClick={openSearch}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
              />
            </FocusItem>

            <input
              ref={inputRef}
              type="text"
              className="header__search-input typography typography--body"
              spellCheck={false}
              autoComplete="off"
              maxLength={MAX_SEARCH_LENGTH}
              tabIndex={isSearchOpen ? 0 : -1}
              placeholder="Looking for anything in particular?"
              value={searchValue}
              onChange={(event) => handleSearchChange(event.target.value)}
              onFocus={() => setIsSearchInputFocused(true)}
              onBlur={() => setIsSearchInputFocused(false)}
            />
          </form>
        </header>
      </HorizontalFocusGroup>
    </div>
  );
}

export { Header };
