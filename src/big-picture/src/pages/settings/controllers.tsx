import { useState } from "react";
import { useGamepadStore } from "../../stores/gamepad.store";
import { SettingsSection } from "./settings-section";

export function ControllerSettingsSection({className}: {className?: string}) {
  const connectedPads = useGamepadStore((state) => state.connectedGamepads);
  const preferredPad = useGamepadStore((state) => state.preferredGamepadIndex);
  const selectPad = useGamepadStore((state) => state.selectGamepad);
  const profile = useGamepadStore((state) => state.activeProfile);
  const saveProfile = useGamepadStore((state) => state.saveProfile);
  const resetProfile = useGamepadStore((state) => state.resetProfile);
  const activePadIndex = useGamepadStore((state) => state.activeGamepadIndex);
  const activePad = connectedPads.find((pad) => pad.index === activePadIndex);
const [backgroundStatus, setBackgroundStatus] = useState("");
const configureBackground = async (enabled: boolean) => {
  try {
    if (enabled && (!activePad || activePad.index > 3 || !/xbox|xinput|045e/i.test(activePad.name))) {
      setBackgroundStatus("Wybierz kontroler Xbox/XInput. DualSense nie jest jeszcze obsługiwany w tle.");
      return;
    }
    if (enabled && activePad && profile.enabled) saveProfile(activePad.name, activePad.layout, {...profile, enabled:false});
    const ok = await window.electron.setBackgroundControllerCursor(enabled, activePad?.index ?? 0, profile.cursorSpeed, profile.deadZone);
    setBackgroundStatus(ok ? (enabled ? "Sterowanie w tle włączone" : "Sterowanie w tle wyłączone") : "Nie udało się zmienić ustawienia");
  } catch { setBackgroundStatus("Moduł niedostępny"); }
};
return <div className={className}><SettingsSection title="Kontrolery" description="Profile, wibracje i przypisania przycisków."><div style={{display:"grid",gap:12}}><div><button type="button" onClick={() => void configureBackground(true)}>Włącz kursor Windows w tle (Xbox)</button><button type="button" onClick={() => void configureBackground(false)}>Wyłącz kursor w tle</button><p role="status">{backgroundStatus}</p></div><label>Aktywny pad <select value={preferredPad ?? ""} onChange={(event) => selectPad(event.target.value === "" ? null : Number(event.target.value))}><option value="">Automatycznie</option>{connectedPads.map((pad) => <option key={pad.index} value={pad.index}>{pad.name}</option>)}</select></label>{activePad && <><label style={{ display: "block" }}><input type="checkbox" checked={profile.vibration} onChange={(event) => saveProfile(activePad.name, activePad.layout, { ...profile, vibration: event.target.checked })} /> Wibracje</label><label style={{ display: "block" }}><input type="checkbox" checked={profile.enabled} onChange={(event) => saveProfile(activePad.name, activePad.layout, { ...profile, enabled: event.target.checked })} /> Sterowanie kursorem</label><label style={{ display: "block" }}>Szybkość kursora: {profile.cursorSpeed}<input type="range" min={1} max={40} value={profile.cursorSpeed} onChange={(event) => saveProfile(activePad.name, activePad.layout, { ...profile, cursorSpeed: Number(event.target.value) })} /></label><label style={{ display: "block" }}>Martwa strefa: {Math.round(profile.deadZone * 100)}%<input type="range" min={0} max={90} value={Math.round(profile.deadZone * 100)} onChange={(event) => saveProfile(activePad.name, activePad.layout, { ...profile, deadZone: Number(event.target.value) / 100 })} /></label><fieldset><legend>Przypisania przycisków</legend>{([["left","Lewe kliknięcie",0],["right","Prawe kliknięcie",1],["doubleClick","Podwójne kliknięcie",2],["switchWindow","Przełącz okno",3],["volumeDown","Ciszej",4],["volumeUp","Głośniej",5],["minimize","Minimalizuj",13],["maximize","Maksymalizuj",12]] as const).map(([action,label,fallback]) => <label key={action} style={{display:"block"}}>{label}<select value={profile.bindings[action] ?? fallback} onChange={event => {
  const next = Number(event.target.value);
  const defaults = {left:0,right:1,doubleClick:2,switchWindow:3,volumeDown:4,volumeUp:5,minimize:13,maximize:12};
  const bindings = {...profile.bindings};
  const previous = bindings[action] ?? fallback;
  const conflict = (Object.keys(defaults) as (keyof typeof defaults)[]).find(key => key !== action && (bindings[key] ?? defaults[key]) === next);
  if (conflict) bindings[conflict] = previous;
  bindings[action] = next;
  saveProfile(activePad.name, activePad.layout, {...profile, bindings});
}}>{Array.from({length: navigator.getGamepads()[activePad.index]?.buttons.length ?? 17},(_,i)=><option key={i} value={i}>{["A / ✕","B / ○","X / □","Y / △","LB / L1","RB / R1","LT / L2","RT / R2","Back","Start","L3","R3","↑","↓","←","→","Home"][i] ?? ("Przycisk "+(i+1))}</option>)}</select></label>)}</fieldset><button type="button" onClick={() => resetProfile(activePad.name, activePad.layout)}>Przywróć domyślne</button><button type="button" disabled={!profile.vibration} onClick={() => useGamepadStore.getState().getService().vibrate(180, 0.4, 0.4, activePad.index)}>Sprawdź wibracje</button></>}</div></SettingsSection></div>;
}
