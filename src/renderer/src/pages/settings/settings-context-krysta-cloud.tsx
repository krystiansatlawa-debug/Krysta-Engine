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
 <h3>{pl?"Połączenia bezpośrednie (eksperymentalne)":"Direct connections (experimental)"}</h3>
 <p>{pl?"Na tym etapie logowanie i test połączenia są oddzielne od synchronizacji plików. Kopie nadal korzystają z wybranego folderu.":"At this stage account authorization and connectivity tests are separate from file sync. Backups still use the selected folder."}</p>
 <h4>Google Drive</h4>
 <p>{pl?"Wybierz plik JSON klienta OAuth typu aplikacja komputerowa z własnego projektu Google Cloud z włączonym Drive API.":"Select a desktop OAuth client JSON from your own Google Cloud project with Drive API enabled."}</p>
 <Button theme="outline" disabled={busy} onClick={()=>void accountAction(()=>accounts.google?window.electron.krystaCloudAccountDisconnect("google"):window.electron.krystaCloudGoogleConnect())}>{accounts.google?(pl?"Odłącz Google Drive":"Disconnect Google Drive"):(pl?"Połącz konto Google":"Connect Google account")}</Button>
 <h4>Synology NAS (WebDAV HTTPS)</h4>
 {accounts.synology?<Button theme="outline" disabled={busy} onClick={()=>void accountAction(()=>window.electron.krystaCloudAccountDisconnect("synology"))}>{pl?"Odłącz Synology":"Disconnect Synology"}</Button>:<>
 <input aria-label="WebDAV HTTPS URL" placeholder="https://nas.example.org:5006/Backups/" value={nasUrl} onChange={e=>setNasUrl(e.target.value)} disabled={busy}/>
 <input aria-label={pl?"Nazwa użytkownika":"Username"} autoComplete="username" placeholder={pl?"Nazwa użytkownika":"Username"} value={nasUser} onChange={e=>setNasUser(e.target.value)} disabled={busy}/>
 <input type="password" aria-label={pl?"Hasło":"Password"} autoComplete="current-password" placeholder={pl?"Hasło":"Password"} value={nasPassword} onChange={e=>setNasPassword(e.target.value)} disabled={busy}/>
 <Button theme="outline" disabled={busy||!nasUrl||!nasUser||!nasPassword} onClick={()=>void accountAction(()=>window.electron.krystaCloudSynologyConnect(nasUrl,nasUser,nasPassword))}>{pl?"Połącz i sprawdź dostęp":"Connect and test access"}</Button>
 </>}
 {accountError&&<p role="alert">{accountError}</p>}
 {error&&<p role="alert">{pl?"Nie udało się zapisać ustawień.":"Unable to save settings."}</p>}
 </div></div>;
}
