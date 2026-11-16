import {useEffect,useState} from "react";
import {useTranslation} from "react-i18next";
import {Button,CheckboxField} from "@renderer/components";
type Settings=Awaited<ReturnType<typeof window.electron.krystaGameWatchSettings>>;
export function KrystaGameUpdateSettings(){
 const {i18n}=useTranslation();const pl=i18n.language.startsWith("pl");
 const [cfg,setCfg]=useState<Settings|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 useEffect(()=>{let active=true;const refresh=()=>void window.electron.krystaGameWatchSettings().then(v=>{if(active)setCfg(v);}).catch(e=>{if(active)setError(String(e));});refresh();const timer=setInterval(refresh,3000);return()=>{active=false;clearInterval(timer);};},[]);
 const change=async(patch:Partial<Settings>)=>{if(!cfg)return;setBusy(true);setError("");try{setCfg(await window.electron.krystaGameWatchSettingsSet({...cfg,...patch}));window.dispatchEvent(new Event("krysta:patch-badges"));}catch(e){setError(String(e));}finally{setBusy(false);}};
 const scan=async()=>{setBusy(true);setError("");try{setCfg(await window.electron.krystaGameWatchScan());}catch(e){setError(String(e));}finally{setBusy(false);}};
 return <div className="settings-context-panel__group">
 <h3>{pl?"Aktualizacje gier":"Game updates"}</h3>
 <CheckboxField label={pl?"Monitoruj wszystkie gry w bibliotece":"Monitor all library games"} checked={cfg?.enabled??false} disabled={!cfg||busy} onChange={()=>void change({enabled:!cfg?.enabled})}/>
 <CheckboxField label={pl?"Powiadomienia systemowe o nowych patchach":"Desktop notifications for new patches"} checked={cfg?.notifications??true} disabled={!cfg||busy} onChange={()=>void change({notifications:!cfg?.notifications})}/>
 <CheckboxField label={pl?"Sprawdzaj po uruchomieniu launchera":"Check at launcher startup"} checked={cfg?.startup??true} disabled={!cfg||busy} onChange={()=>void change({startup:!cfg?.startup})}/>
 <CheckboxField label={pl?"Wstrzymuj skanowanie i otwieranie aktualizacji podczas grania":"Defer update scans and opening updates while playing"} checked={cfg?.pauseDuringPlay??true} disabled={!cfg||busy} onChange={()=>void change({pauseDuringPlay:!cfg?.pauseDuringPlay})}/>
 {cfg?.pauseDuringPlay&&cfg.pausedDuringPlay&&<p role="status">{pl?"Wykryto uruchomioną grę. Krysta odracza skanowanie.":"A running game was detected. Krysta is deferring scans."}</p>}
 <small>{pl?"To ustawienie nie wstrzymuje pobierania przez Steam ani inne klienty.":"This setting does not pause downloads in Steam or other clients."}</small>
 <label htmlFor="krysta-update-interval">{pl?"Sprawdzaj co":"Check every"}</label>
 <select id="krysta-update-interval" value={cfg?.intervalHours??6} disabled={!cfg||busy} onChange={e=>void change({intervalHours:Number(e.target.value)})} style={{background:"#202020",color:"inherit",padding:8,border:"1px solid #555",borderRadius:4,maxWidth:300}}>{[1,3,6,12,24].map(n=><option key={n} value={n}>{n} h</option>)}</select>
 <Button theme="outline" disabled={!cfg||busy||cfg.scanning||(cfg.pauseDuringPlay&&cfg.pausedDuringPlay)} onClick={()=>void scan()}>{cfg?.scanning?(pl?"Sprawdzanie…":"Checking…"):(pl?"Sprawdź teraz":"Check now")}</Button>
 {cfg?.lastFinished&&<p>{pl?"Ostatni skan":"Last scan"}: {new Date(cfg.lastFinished).toLocaleString(i18n.language)}</p>}
 <small>{pl?"Dotyczy gier PC. Indywidualne ustawienia gry mają pierwszeństwo. Pierwsze sprawdzenie zapisuje punkt odniesienia; powiadomienia dotyczą kolejnych patchy. Launcher musi działać.":"PC games only. Individual game settings take precedence. First check establishes a baseline; subsequent patches trigger notifications. Launcher must be running."}</small>
 {(error||cfg?.lastError)&&<p role="alert">{error||cfg?.lastError}</p>}
 </div>;
}
