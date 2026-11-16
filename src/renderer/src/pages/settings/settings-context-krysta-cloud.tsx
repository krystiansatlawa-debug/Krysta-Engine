import { useEffect,useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, CheckboxField } from "@renderer/components";
export function SettingsContextKrystaCloud(){
 const {i18n}=useTranslation();const pl=i18n.language.startsWith("pl");
 const [cfg,setCfg]=useState<{provider:string;folder?:string;autoBackup?:boolean}|null>(null);
 const [busy,setBusy]=useState(false);const [error,setError]=useState(false);
 useEffect(()=>{let active=true;void window.electron.krystaCloudConfig().then(c=>{if(active)setCfg(c);}).catch(()=>{if(active)setError(true);});return()=>{active=false;};},[]);
 const run=async(fn:()=>Promise<{provider:string;folder?:string;autoBackup?:boolean}>)=>{setBusy(true);setError(false);try{setCfg(await fn());}catch{setError(true);}finally{setBusy(false);}};
 return <div className="settings-context-panel"><div className="settings-context-panel__group">
 <h3>{pl?"Dostawca chmury":"Cloud provider"}</h3>
 <select aria-label={pl?"Dostawca chmury":"Cloud provider"} value={cfg?.provider??"hydra"} disabled={!cfg||busy} onChange={e=>{const value=e.target.value;void run(()=>window.electron.krystaCloudProvider(value));}} style={{background:"#202020",color:"inherit",padding:10,border:"1px solid #555",borderRadius:4}}>
 <option value="hydra">Hydra Cloud</option><option value="google">Google Drive</option><option value="synology">Synology Drive</option><option value="local">{pl?"Folder lokalny lub sieciowy":"Local or network folder"}</option></select>
 {cfg?.provider==="hydra"?<p>{pl?"Oryginalna usługa Hydra Cloud działa na dotychczasowych zasadach.":"Original Hydra Cloud maintains its existing rules."}</p>:<>
 <p>{pl?"Wybierz lokalny folder synchronizowany przez klienta Google Drive lub Synology Drive. Kopie są tworzone niezależnie od Hydra Cloud.":"Select a local folder synchronized by your Google Drive or Synology Drive client. Backups are independent of Hydra Cloud."}</p>
 <p style={{overflowWrap:"anywhere"}}>{cfg?.folder??(pl?"Nie wybrano folderu":"No folder selected")}</p>
 <Button theme="outline" disabled={busy||!cfg} onClick={()=>void run(()=>window.electron.krystaCloudFolder())}>{pl?"Wybierz folder":"Choose folder"}</Button>
 <CheckboxField checked={cfg?.autoBackup===true} disabled={busy||!cfg?.folder} label={pl?"Automatyczna kopia po zakończeniu gry":"Automatically back up after exiting a game"} onChange={()=>void run(()=>window.electron.krystaCloudAuto(!cfg?.autoBackup))}/>
 <p>{pl?"Kopia jest tworzona 15 sekund po wykryciu zakończenia gry. Klient chmury odpowiada za przesłanie plików. Przywracanie wymaga potwierdzenia.":"A backup is created 15 seconds after a tracked game ends. Your cloud client uploads the files. Restore requires confirmation."}</p>
 </>}
 {error&&<p role="alert">{pl?"Nie udało się zapisać ustawień.":"Unable to save settings."}</p>}
 </div></div>;
}
