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
  type Position = "tl"|"tr"|"bl"|"br";
  const [position,setPosition]=useState<Position>("tl");
  const [positionReady,setPositionReady]=useState(false);
  useEffect(()=>{
    let active=true;
    void window.electron.krystaFpsPosition().then(value=>{if(active){setPosition(value);setPositionReady(true);}}).catch(()=>{if(active)setError(true);});
    return()=>{active=false;};
  },[]);
  const changePosition=async(value:Position)=>{
    setBusy(true);setError(false);
    try{setPosition(await window.electron.krystaFpsSetPosition(value));}catch{setError(true);}finally{setBusy(false);}
  };
  const positions:{value:Position;label:string}[]=[
    {value:"tl",label:pl?"Lewy górny róg":"Top left"},
    {value:"tr",label:pl?"Prawy górny róg":"Top right"},
    {value:"bl",label:pl?"Lewy dolny róg":"Bottom left"},
    {value:"br",label:pl?"Prawy dolny róg":"Bottom right"}
  ];
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
      <label htmlFor="krysta-fps-position">{pl?"Położenie licznika FPS":"FPS counter position"}</label>
      <select id="krysta-fps-position" value={position} disabled={!positionReady||busy||window.electron.platform!=="win32"} onChange={e=>void changePosition(e.target.value as Position)} style={{background:"#202020",color:"inherit",border:"1px solid #555",borderRadius:4,padding:8,maxWidth:300}}>
        {positions.map(p=><option key={p.value} value={p.value}>{p.label}</option>)}
      </select>
      <div aria-label={pl?"Podgląd położenia licznika":"Counter position preview"} style={{position:"relative",width:"100%",maxWidth:300,aspectRatio:"16 / 9",background:"#171717",border:"1px solid #444",borderRadius:6}}>
        <span style={{position:"absolute",top:position.startsWith("t")?8:undefined,bottom:position.startsWith("b")?8:undefined,left:position.endsWith("l")?8:undefined,right:position.endsWith("r")?8:undefined,background:"rgba(40,40,40,.78)",color:"#d7d7d7",border:"1px solid #444",borderRadius:3,padding:"3px 6px",font:"12px Arial,sans-serif"}}>FPS: 124</span>
      </div>
      <p>{capture?.available?(pl?"PresentMon: dostępny":"PresentMon: available"):(pl?"PresentMon: wymagany plik konsolowy":"PresentMon: console executable required")}</p>
      {capture?.status==="capture-error"&&<p role="alert">{pl?"Pomiar nie został uruchomiony. Sprawdź uprawnienia i wersję PresentMon.":"Capture failed. Check PresentMon version and permissions."}</p>}
      <button type="button" onClick={()=>void selectTool()}>{pl?"Wskaż PresentMon.exe":"Select PresentMon.exe"}</button>
      <button type="button" onClick={()=>void window.electron.openExternal("https://github.com/GameTechDev/PresentMon/releases")}>{pl?"Pobierz PresentMon":"Get PresentMon"}</button>
      {error&&<p role="alert">{pl?"Nie udało się odczytać lub zapisać ustawienia.":"Could not read or save the preference."}</p>}
    </div>
  </div>;
}
