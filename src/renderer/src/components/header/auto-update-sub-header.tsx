import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { SyncIcon } from "@primer/octicons-react";
import "./auto-update-header.scss";

export const releasesPageUrl =
  "https://github.com/krystiansatlawa-debug/Krysta-Engine/releases";

type State=Awaited<ReturnType<typeof window.electron.krystaUpdatesStatus>>;
export function AutoUpdateSubHeader() {
 const {i18n}=useTranslation("header");
 const pl=i18n.language.startsWith("pl");
 const [state,setState]=useState<State|null>(null);
 const [error,setError]=useState("");
 const [opening,setOpening]=useState(false);
 useEffect(()=>{
  let disposed=false,timer:ReturnType<typeof setTimeout>;
  const poll=async()=>{
   let delay=15000;
   try{const s=await window.electron.krystaUpdatesStatus();if(disposed)return;setState(s);delay=s.phase==="downloading"?1000:15000;}catch{}
   if(!disposed)timer=setTimeout(poll,delay);
  };
  void poll();
  return ()=>{disposed=true;clearTimeout(timer);};
 },[]);
 if(!state||state.phase==="idle"||state.phase==="checking")return null;
 const percent=state.total?Math.min(100,Math.floor(100*state.received/state.total)):0;
 const action=async()=>{
  setOpening(true);setError("");
  try{
   if(state.phase==="ready")await window.electron.krystaUpdatesInstall();
   else if(state.phase==="error")await window.electron.krystaUpdatesCheck();
   else await window.electron.krystaUpdatesOpen("krysta");
  }catch(e){setError(String(e));}finally{setOpening(false);}
 };
 return <header className="auto-update-sub-header">
 {state.phase==="downloading"?<span role="status">{pl?"Pobieranie Krysty":"Downloading Krysta"} {state.version} — {percent}%</span>:
 <button type="button" className="auto-update-sub-header__new-version-button" onClick={()=>void action()} disabled={opening}>
 <SyncIcon className="auto-update-sub-header__new-version-icon" size={12}/>
 {state.phase==="ready"?(pl?"Zainstaluj Krystę":"Install Krysta"):state.phase==="error"?(pl?"Ponów pobieranie Krysty":"Retry Krysta download"):(pl?"Pobierz Krystę":"Download Krysta")} {state.version}
 </button>}
 {error&&<span role="alert">{error}</span>}
 </header>;
}
