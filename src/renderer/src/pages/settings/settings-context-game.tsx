import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckboxField } from "@renderer/components";

export function SettingsContextGame() {
  const { i18n } = useTranslation();
  const pl = i18n.language.startsWith("pl");
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void window.electron.krystaFpsPreference().then(value => {
      if(active){setEnabled(value);setReady(true);}
    }).catch(()=>{if(active)setError(true);});
    return () => {active=false;};
  }, []);
  const toggle = async () => {
    setBusy(true);setError(false);
    try {setEnabled(await window.electron.krystaSetFpsPreference(!enabled));}
    catch {setError(true);}
    finally {setBusy(false);}
  };
  return <div className="settings-context-panel">
    <div className="settings-context-panel__group">
      <h3>{pl?"Monitor wydajności":"Performance monitor"}</h3>
      <CheckboxField label={pl?"Włącz licznik FPS w grach":"Enable in-game FPS counter"} checked={enabled} disabled={!ready||busy||window.electron.platform!=="win32"} onChange={()=>void toggle()}/>
      <p>{pl?"Preferencja zostanie zapisana. Pomiar FPS i nakładka w grze wymagają jeszcze integracji z silnikiem pomiarowym.":"Preference is saved. FPS measurement and the game overlay still require a measurement backend."}</p>
      {error&&<p role="alert">{pl?"Nie udało się odczytać lub zapisać ustawienia.":"Could not read or save the preference."}</p>}
    </div>
  </div>;
}
