import { useEffect,useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components";

type Entry={id:string;createdAt:string;files:number};
export function KrystaGameCloud({shop,objectId}:{shop:string;objectId:string}){
 const {i18n}=useTranslation();const pl=i18n.language.startsWith("pl");
 const [cfg,setCfg]=useState<{provider:string;folder?:string}|null>(null);
 const [entries,setEntries]=useState<Entry[]>([]);
 const [busy,setBusy]=useState(false);const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const reload=async()=>{const c=await window.electron.krystaCloudConfig();if(c.provider!=="hydra"&&c.folder)setEntries(await window.electron.krystaCloudList(shop,objectId));setCfg(c);};
 useEffect(()=>{let active=true;void (async()=>{try{const c=await window.electron.krystaCloudConfig();const list=c.provider!=="hydra"&&c.folder?await window.electron.krystaCloudList(shop,objectId):[];if(active){setCfg(c);setEntries(list);}}catch(e){if(active)setError(String(e));}})();return()=>{active=false;};},[shop,objectId]);
 const backup=async()=>{setBusy(true);setError("");setNotice("");try{if(await window.electron.krystaCloudBackup(shop,objectId)){await reload();setNotice(pl?"Kopia zapisana w wybranym folderze.":"Backup saved to selected folder.");}}catch(e){setError(String(e));}finally{setBusy(false);}};
 return <section className="krysta-game-extra"><h2>Krysta Cloud</h2>
 {!cfg?<p>{pl?"Ładowanie...":"Loading..."}</p>:cfg.provider==="hydra"?<p>{pl?"Wybrano Hydra Cloud. Skorzystaj z oryginalnego przycisku zapisów gry lub zmień dostawcę w Ustawienia → Krysta Cloud.":"Hydra Cloud selected. Use the original cloud save button or change provider in Settings → Krysta Cloud."}</p>:!cfg.folder?<p>{pl?"Wybierz folder w Ustawienia → Krysta Cloud.":"Select a folder in Settings → Krysta Cloud."}</p>:<>
 <p>{cfg.provider==="google"?"Google Drive":cfg.provider==="synology"?"Synology Drive":pl?"Folder lokalny":"Local folder"}</p>
 <Button theme="outline" disabled={busy} onClick={()=>void backup()}>{pl?"Utwórz kopię zapisów":"Create save backup"}</Button>
 <h3>{pl?"Historia kopii":"Backup history"}</h3>
 {!entries.length?<p>{pl?"Brak kopii.":"No backups."}</p>:entries.map(e=><div key={e.id} style={{padding:12,border:"1px solid #444",borderRadius:5}}>{new Date(e.createdAt).toLocaleString(i18n.language)} · {e.files} {pl?"plików":"files"}</div>)}
 </>}
 {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" style={{overflowWrap:"anywhere"}}>{error}</p>}
 </section>;
}
