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
  const [capture,setCapture]=useState<{available:boolean;status:string}|null>(null);
  useEffect(()=>{
    let active=true;
    const refresh=()=>void window.electron.krystaFpsStatus().then(value=>{if(active)setCapture(value);}).catch(()=>{});
    refresh();const timer=setInterval(refresh,2000);
    return()=>{active=false;clearInterval(timer);};
  },[]);
  const selectTool=async()=>{try{await window.electron.krystaFpsSelectTool();setCapture(await window.electron.krystaFpsStatus());}catch{setError(true);}};
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
      <p>{pl?"Licznik pokazuje rzeczywistą częstotliwość prezentowania klatek w wykrytej grze. Zalecany tryb okna bez ramek.":"Shows measured presentation FPS in the detected game. Borderless mode is recommended."}</p>
      <p>{capture?.available?(pl?"PresentMon: dostępny":"PresentMon: available"):(pl?"PresentMon: wymagany plik konsolowy":"PresentMon: console executable required")}</p>
      {capture?.status==="capture-error"&&<p role="alert">{pl?"Pomiar nie został uruchomiony. Sprawdź uprawnienia i wersję PresentMon.":"Capture failed. Check PresentMon version and permissions."}</p>}
      <button type="button" onClick={()=>void selectTool()}>{pl?"Wskaż PresentMon.exe":"Select PresentMon.exe"}</button>
      <button type="button" onClick={()=>void window.electron.openExternal("https://github.com/GameTechDev/PresentMon/releases")}>{pl?"Pobierz PresentMon":"Get PresentMon"}</button>
      {error&&<p role="alert">{pl?"Nie udało się odczytać lub zapisać ustawienia.":"Could not read or save the preference."}</p>}
    </div>
  </div>;
}
