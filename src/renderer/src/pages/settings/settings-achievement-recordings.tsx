import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckboxField, SelectField } from "@renderer/components";

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
      <CheckboxField
        label={pl ? "Nagrywaj dźwięk systemowy" : "Record system audio"}
        checked={state?.settings.audio ?? false}
        disabled={disabled || !state?.settings.enabled}
        onChange={() => void update({ audio: !state?.settings.audio })}
      />
      <small>{pl ? "Klip rozpoczyna się po wykryciu osiągnięcia i jest zapisywany lokalnie. Nagrywane jest rozpoznane, aktywne okno gry. Dźwięk systemowy może zawierać dźwięki innych aplikacji; mikrofon nie jest nagrywany. Klipy znajdziesz w zakładce Nagrania na górnym pasku." : "Clips start after achievement detection and are stored locally. Only the identified foreground game window is recorded. System audio can include other applications; the microphone is not recorded. Find clips in the Recordings tab in the top bar."}</small>
      {state && !state.supported && <small>{pl ? "Funkcja dostępna tylko na Windows." : "Available on Windows only."}</small>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
