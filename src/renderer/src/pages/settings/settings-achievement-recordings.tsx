import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, CheckboxField, SelectField } from "@renderer/components";

type State = Awaited<ReturnType<typeof window.electron.krystaRecordingsState>>;
type Settings = State["settings"];

export function SettingsAchievementRecordings() {
  const { i18n } = useTranslation();
  const pl = i18n.language.startsWith("pl");
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void window.electron.krystaRecordingsState()
      .then(value => { if (active) setState(value); })
      .catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, []);

  const update = async (patch: Partial<Settings>) => {
    if (!state || busy) return;
    setBusy(true);
    setError("");
    try {
      await window.electron.krystaRecordingsSettings({ ...state.settings, ...patch });
      setState(await window.electron.krystaRecordingsState());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const chooseFolder=async(reset=false)=>{setBusy(true);setError("");try{await window.electron.krystaRecordingsChooseFolder(reset);setState(await window.electron.krystaRecordingsState());}catch(e){setError(String(e));}finally{setBusy(false);}};
  const disabled = !state?.supported || busy;
  return (
    <div className="settings-context-panel__group">
      <h3>{pl ? "Nagrywanie osiągnięć" : "Achievement recording"}</h3>
      <CheckboxField
        label={pl ? "Automatycznie nagrywaj po zdobyciu osiągnięcia" : "Automatically record after an achievement unlock"}
        checked={state?.settings.enabled ?? false}
        disabled={disabled}
        onChange={() => void update({ enabled: !state?.settings.enabled })}
      />
      <SelectField
        className="settings-screenshots__select"
        label={pl ? "Długość nagrania" : "Recording duration"}
        value={String(state?.settings.seconds ?? 15)}
        options={[5, 10, 15, 30, 45, 60].map(n => ({ key: String(n), value: String(n), label: n + " s" }))}
        disabled={disabled || !state?.settings.enabled}
        onChange={event => void update({ seconds: Number(event.target.value) })}
      />
      {([
        {key:"preSeconds",label:pl?"Bufor przed osiągnięciem":"Replay before unlock",values:[0,5,10,15,30],suffix:" s"},
        {key:"quality",label:pl?"Rozdzielczość (maks.)":"Resolution (max)",values:[720,1080,1440],suffix:"p"},
        {key:"fps",label:pl?"Liczba klatek (maks.)":"Frame rate (max)",values:[30,60],suffix:" FPS"},
        {key:"limitGb",label:pl?"Limit miejsca na nagrania":"Recordings storage limit",values:[1,5,10,20,50],suffix:" GB"},
      ] as const).map(field=><SelectField key={field.key} className="settings-screenshots__select" label={field.label} value={String(state?.settings[field.key]??field.values[0])} options={field.values.map(n=>({key:String(n),value:String(n),label:n+field.suffix}))} disabled={disabled||!state?.settings.enabled} onChange={event=>void update({[field.key]:Number(event.target.value)})}/>)}
      <SelectField className="settings-screenshots__select" label={pl?"Skrót do ręcznego zapisu klipu":"Manual clip hotkey"} value={state?.settings.hotkey??"Control+Shift+F9"} options={["","Control+Shift+F9","Control+Shift+F8","Alt+F9","F9"].map(h=>({key:h||"disabled",value:h,label:h.replace("Control","Ctrl")||(pl?"Wyłączony":"Disabled")}))} disabled={disabled||!state?.settings.enabled} onChange={e=>void update({hotkey:e.target.value})}/>
      {state?.shortcutError&&<small role="alert">{pl?"Skrót zajęty. Wybierz inny.":"Hotkey unavailable. Choose another."}</small>}
      <CheckboxField
        label={pl ? "Nagrywaj dźwięk systemowy" : "Record system audio"}
        checked={state?.settings.audio ?? false}
        disabled={disabled || !state?.settings.enabled}
        onChange={() => void update({ audio: !state?.settings.audio })}
      />
      <div><small>{pl?"Folder nagrań":"Recordings folder"}: {state?.folder??"—"}</small><div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}><Button theme="outline" disabled={disabled} onClick={()=>void chooseFolder()}>{pl?"Zmień folder":"Change folder"}</Button><Button theme="outline" disabled={disabled} onClick={()=>void chooseFolder(true)}>{pl?"Przywróć domyślny":"Reset folder"}</Button></div></div>
      <small>{pl?"Bufor działa w pamięci wyłącznie podczas gry w rozpoznanym aktywnym oknie. Zapis obejmuje do wybranej liczby sekund przed zdarzeniem (w zależności od gotowości bufora) oraz wybraną długość po nim. Po osiągnięciu limitu dysku nowe klipy nie są zapisywane; starsze nie są usuwane. Zmiana folderu nie przenosi wcześniejszych plików. Dźwięk systemowy może zawierać inne aplikacje, mikrofon nie jest nagrywany.":"The in-memory buffer is active only in an identified foreground game. Clips contain up to the selected pre-event time depending on buffer readiness, plus the selected post-event duration. New clips are blocked at the storage limit; old clips are not deleted. Changing folders does not move existing files. System audio may include other apps; microphone is not recorded."}</small>
      {state && !state.supported && <small>{pl ? "Funkcja dostępna tylko na Windows." : "Available on Windows only."}</small>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
