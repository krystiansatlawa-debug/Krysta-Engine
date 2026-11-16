import {useEffect,useState} from "react";
import {useTranslation} from "react-i18next";
import {Button} from "@renderer/components";
type Info=Awaited<ReturnType<typeof window.electron.krystaUpdatesCheck>>;
export function SettingsContextKrystaUpdates(){
 const {i18n}=useTranslation();const pl=i18n.language.startsWith("pl");
 const [info,setInfo]=useState<Info|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [prefs,setPrefs]=useState<{automatic:boolean;notifications:boolean}|null>(null);
 const [notes,setNotes]=useState(false);
 const check=async()=>{setBusy(true);setError("");try{setInfo(await window.electron.krystaUpdatesCheck());}catch(e){setError(String(e));}finally{setBusy(false);}};
 useEffect(()=>{void window.electron.krystaUpdatesPrefs().then(setPrefs).catch(e=>setError(String(e)));void check();},[]);
 const update=async(automatic:boolean,notifications:boolean)=>{try{setPrefs(await window.electron.krystaUpdatesSet(automatic,notifications));}catch(e){setError(String(e));}};
 const open=(kind:"hydra"|"krysta"|"sync")=>void window.electron.krystaUpdatesOpen(kind).catch(e=>setError(String(e)));
 return <div className="settings-context-panel"><div className="settings-context-panel__group">
 <h3>Krysta Launcher</h3><p>{pl?"Zainstalowana wersja":"Installed version"}: {info?.version??"—"}</p>
 <p>{pl?"Najnowsze opublikowane wydanie Krysty":"Latest published Krysta release"}: {info?info.krysta?.tag??(pl?"Brak wydania":"No release"):"—"}</p>
 <Button theme="outline" onClick={()=>open("krysta")}>{pl?"Wydania i instalatory Krysty":"Krysta releases and installers"}</Button>
 <h3>Hydra Launcher</h3><p>{pl?"Wersja bazowa (numer pakietu)":"Base version (package version)"}: {info?.version??"—"}</p>
 <p>{pl?"Najnowsze wydanie Hydry":"Latest Hydra release"}: {info?.hydra?.tag??"—"}</p>
 {info&&<p>{info.hydraNew===true?(pl?"Nowa wersja Hydry — oczekuje na integrację z Krystą.":"New Hydra version — requires integration into Krysta."):info.hydraNew===false?(pl?"Brak nowszej wersji bazowej.":"No newer upstream release."):(pl?"Nie można porównać wersji.":"Cannot compare versions.")}</p>}
 <Button theme="outline" disabled={busy} onClick={()=>void check()}>{busy?(pl?"Sprawdzanie…":"Checking…"):(pl?"Sprawdź aktualizacje":"Check for updates")}</Button>
 {info&&<p>{pl?"Ostatnie sprawdzenie":"Last checked"}: {new Date(info.checkedAt).toLocaleString(i18n.language)}</p>}
 <Button theme="outline" onClick={()=>open("sync")}>{pl?"Status integracji na GitHubie":"Integration status on GitHub"}</Button>
 <label><input type="checkbox" disabled={!prefs} checked={prefs?.automatic??false} onChange={e=>void update(e.target.checked,prefs?.notifications??true)}/> {pl?"Automatyczne sprawdzanie":"Automatic checks"}</label>
 <label><input type="checkbox" disabled={!prefs} checked={prefs?.notifications??false} onChange={e=>void update(prefs?.automatic??true,e.target.checked)}/> {pl?"Powiadomienia o nowych wersjach Hydry":"New Hydra release notifications"}</label>
 <Button theme="outline" disabled={!info} onClick={()=>setNotes(!notes)}>{pl?"Historia zmian najnowszych wydań":"Latest release notes"}</Button>
 {notes&&info&&<><h4>Krysta {info.krysta?.tag??""}</h4><p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{info.krysta?.body??(pl?"Brak opublikowanego wydania.":"No published release.")}</p><h4>Hydra {info.hydra?.tag??""}</h4><p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{info.hydra?.body??"—"}</p></>}
 <p>{pl?"Instalatory Krysty otwierają się na oficjalnej stronie repozytorium. Aktualizacja Hydry nie jest instalowana automatycznie.":"Krysta installers are available from the project release page. Hydra updates are never installed here automatically."}</p>
 {error&&<p role="alert">{error}</p>}
 </div></div>;
}
