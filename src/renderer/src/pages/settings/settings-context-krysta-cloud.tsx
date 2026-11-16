import { useEffect,useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, CheckboxField } from "@renderer/components";
export function SettingsContextKrystaCloud(){
 const {i18n}=useTranslation();const pl=i18n.language.startsWith("pl");
 const [cfg,setCfg]=useState<{provider:string;folder?:string;autoBackup?:boolean}|null>(null);
 const [busy,setBusy]=useState(false);const [error,setError]=useState(false);
 const [accounts,setAccounts]=useState<{google:boolean;synology:boolean}|null>(null);
 const [nasUrl,setNasUrl]=useState("");
 const [nasUser,setNasUser]=useState("");
 const [nasPassword,setNasPassword]=useState("");
 const [accountError,setAccountError]=useState("");
 useEffect(()=>{
   let active=true;
   void window.electron.krystaCloudAccountStatus().then(value=>{if(active)setAccounts(value);}).catch(e=>{if(active)setAccountError(String(e));});
   return()=>{active=false;};
 },[]);
 const accountAction=async(fn:()=>Promise<boolean>)=>{
   setBusy(true);setAccountError("");
   try{await fn();setAccounts(await window.electron.krystaCloudAccountStatus());}
   catch(e){setAccountError(String(e));}
   finally{setNasPassword("");setBusy(false);}
 };

 useEffect(()=>{let active=true;void window.electron.krystaCloudConfig().then(c=>{if(active)setCfg(c);}).catch(()=>{if(active)setError(true);});return()=>{active=false;};},[]);
 const run=async(fn:()=>Promise<{provider:string;folder?:string;autoBackup?:boolean}>)=>{setBusy(true);setError(false);try{setCfg(await fn());}catch{setError(true);}finally{setBusy(false);}};
 return <div className="settings-context-panel"><div className="settings-context-panel__group">
 <h3>{pl?"Dostawca chmury":"Cloud provider"}</h3>
 <select aria-label={pl?"Dostawca chmury":"Cloud provider"} value={cfg?.provider??"hydra"} disabled={!cfg||busy} onChange={e=>{const value=e.target.value;void run(()=>window.electron.krystaCloudProvider(value));}} style={{background:"#202020",color:"inherit",padding:10,border:"1px solid #555",borderRadius:4}}>
 <option value="hydra">Hydra Cloud</option><option value="google">Google Drive</option><option value="synology">Synology Drive</option><option value="local">{pl?"Folder lokalny lub sieciowy":"Local or network folder"}</option></select>
 {cfg?.provider==="hydra"?<p>{pl?"Oryginalna usługa Hydra Cloud działa na dotychczasowych zasadach.":"Original Hydra Cloud maintains its existing rules."}</p>:<>
 {cfg?.provider==="local"?<> <p>{pl?"Wybierz folder kopii lokalnych.":"Choose a local backup folder."}</p>
 <p style={{overflowWrap:"anywhere"}}>{cfg?.folder??(pl?"Nie wybrano folderu":"No folder selected")}</p>
 <Button theme="outline" disabled={busy||!cfg} onClick={()=>void run(()=>window.electron.krystaCloudFolder())}>{pl?"Wybierz folder":"Choose folder"}</Button></>:<p>{pl?"Zapisy wykryte przez Ludusavi są przesyłane bezpośrednio na konto. Nie wybierasz folderu lokalnego.":"Ludusavi-detected saves are uploaded directly to your account. No local folder selection is required."}</p>}
 <CheckboxField checked={cfg?.autoBackup===true} disabled={busy||!(cfg?.provider==="local"?cfg.folder:cfg?.provider==="google"?accounts?.google:accounts?.synology)} label={pl?"Automatyczna kopia po zakończeniu gry":"Automatically back up after exiting a game"} onChange={()=>void run(()=>window.electron.krystaCloudAuto(!cfg?.autoBackup))}/>
 <p>{pl?"Kopia jest tworzona 15 sekund po wykryciu zakończenia gry. Krysta przesyła kopię bezpośrednio przy połączonym koncie. Przywracanie kopii z innego komputera nie jest jeszcze dostępne.":"A backup is created 15 seconds after a tracked game ends. Krysta uploads directly for connected accounts. Restoring snapshots from another computer is not yet available."}</p>
 </>}
 {(cfg?.provider==="google"||cfg?.provider==="synology")&&<><h3>{pl?"Połączenia z chmurą":"Cloud connections"}</h3>
 <p>{pl?"Połącz wybranego dostawcę. Kopie z tego komputera są przesyłane bezpośrednio; lokalna historia pozostaje dostępna.":"Connect your provider. Backups from this computer upload directly; local history remains available."}</p>
 {cfg.provider==="google"&&<><h4>Google Drive</h4>
 <p>{pl?"Wybierz plik JSON klienta OAuth typu aplikacja komputerowa z własnego projektu Google Cloud z włączonym Drive API.":"Select a desktop OAuth client JSON from your own Google Cloud project with Drive API enabled."}</p>
 <Button theme="outline" disabled={busy||!accounts} onClick={()=>void accountAction(()=>accounts?.google?window.electron.krystaCloudAccountDisconnect("google"):window.electron.krystaCloudGoogleConnect())}>{accounts?.google?(pl?"Odłącz Google Drive":"Disconnect Google Drive"):(pl?"Połącz konto Google":"Connect Google account")}</Button>
 </>}{cfg.provider==="synology"&&<><h4>Synology NAS (WebDAV HTTPS)</h4>
 {accounts?.synology?<Button theme="outline" disabled={busy} onClick={()=>void accountAction(()=>window.electron.krystaCloudAccountDisconnect("synology"))}>{pl?"Odłącz Synology":"Disconnect Synology"}</Button>:<>
 <input aria-label="WebDAV HTTPS URL" placeholder="https://nas.example.org:5006/Backups/" value={nasUrl} onChange={e=>setNasUrl(e.target.value)} disabled={busy} style={{background:"#202020",color:"inherit",padding:10,border:"1px solid #555",borderRadius:6}}/>
 <input aria-label={pl?"Nazwa użytkownika":"Username"} autoComplete="username" placeholder={pl?"Nazwa użytkownika":"Username"} value={nasUser} onChange={e=>setNasUser(e.target.value)} disabled={busy} style={{background:"#202020",color:"inherit",padding:10,border:"1px solid #555",borderRadius:6}}/>
 <input type="password" aria-label={pl?"Hasło":"Password"} autoComplete="current-password" placeholder={pl?"Hasło":"Password"} value={nasPassword} onChange={e=>setNasPassword(e.target.value)} disabled={busy} style={{background:"#202020",color:"inherit",padding:10,border:"1px solid #555",borderRadius:6}}/>
 <Button theme="outline" disabled={busy||!accounts||!nasUrl||!nasUser||!nasPassword} onClick={()=>void accountAction(()=>window.electron.krystaCloudSynologyConnect(nasUrl,nasUser,nasPassword))}>{pl?"Połącz i sprawdź dostęp":"Connect and test access"}</Button>
 </>}
 </>}</>}
 {accountError&&<p role="alert">{accountError}</p>}
 {error&&<p role="alert">{pl?"Nie udało się zapisać ustawień.":"Unable to save settings."}</p>}
 </div></div>;
}
