import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import "./krysta-game-updates.scss";
import { providerStatusIsStale } from "../../../../shared/game-update-patch-history";
import { needsAutomaticGameUpdateRefresh } from "../../../../shared/game-update-refresh-policy";
type Watch=Awaited<ReturnType<typeof window.electron.krystaGameWatchGet>>;
export function KrystaGameWatch({shop,id,executablePath}:{shop:string;id:string;executablePath?:string|null}){
 const {i18n}=useTranslation();const pl=i18n.language.startsWith("pl");
 const [watch,setWatch]=useState<Watch>(null),[override,setOverride]=useState<"inherit"|"on"|"off">("inherit"),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");
 const [autoChecking,setAutoChecking]=useState(false);
 useEffect(()=>{
  let active=true;setReady(false);setNotice("");setWatch(null);setBusy(false);setAutoChecking(true);
  void (async()=>{
   try{
    // Local metadata appears first. Checking remote updates is automatic.
    const local=await window.electron.krystaGameWatchGet(shop,id);
    if(!active)return;
    setWatch(local);setOverride(local?.override??"inherit");setReady(true);
    if(!local||shop==="launchbox"||!needsAutomaticGameUpdateRefresh(local))return;
    const checked=await window.electron.krystaGameWatchCheck(shop,id);
    if(active&&checked){setWatch(checked);setOverride(checked.override??"inherit");}
   }catch(e){if(active)setNotice(String(e));}
   finally{
    if(active){setAutoChecking(false);window.dispatchEvent(new Event("krysta:patch-badges"));}
   }
  })();
  return()=>{active=false;};
 },[shop,id,executablePath]);
 const changeMonitor=async(value:"inherit"|"on"|"off")=>{const previous=override;setOverride(value);setBusy(true);setNotice("");try{setWatch(await window.electron.krystaGameWatchSet(shop,id,value));}catch(e){setOverride(previous);setNotice(String(e));}finally{setBusy(false);window.dispatchEvent(new Event("krysta:patch-badges"));}};
 const checkNow=async()=>{setBusy(true);setNotice("");try{setWatch(await window.electron.krystaGameWatchCheck(shop,id));}catch(e){setNotice(String(e));}finally{setBusy(false);window.dispatchEvent(new Event("krysta:patch-badges"));}};
 const official=shop==="steam"||shop==="epic"||(shop==="custom"&&/^(ubi-owned-|ubisoft-)/.test(id));
 const [integrity,setIntegrity]=useState("");
 const verify=async(action:"official"|"local")=>{
  setBusy(true);setIntegrity("");
  try{
   const result=await window.electron.krystaGameIntegrity(shop,id,action);
   if(result.mode==="local")setIntegrity((pl?"Odczytano plik EXE. Brak wzorca producenta — integralność niepotwierdzona. SHA-256: ":"EXE readable. No publisher reference — integrity unconfirmed. SHA-256: ")+result.sha256);
   else if(result.mode==="official")setIntegrity(pl?"Przekazano polecenie weryfikacji do Steam. Wynik sprawdź w Steam.":"Validation requested in Steam. Check Steam for results.");
   else setIntegrity(pl?"Otworzono "+result.provider+". Wybierz opcję weryfikacji plików gry.":"Opened "+result.provider+". Select the game's file verification option.");
  }catch(e){setIntegrity(String(e));}finally{setBusy(false);}
 };
 const openClient=async()=>{setBusy(true);setNotice("");try{await window.electron.krystaGameWatchOpenClient(shop,id);if(shop==="steam"&&required)setNotice(pl?"Zlecono Steam sprawdzenie plików tej gry. Steam może pobrać brakujące lub nieaktualne pliki. Postęp sprawdź w Steam.":"Steam game-file validation requested. Steam may download missing or outdated files. Check progress in Steam.");}catch(e){setNotice(String(e));}finally{setBusy(false);}};
 const stale=watch?.updateState!=="unknown"&&watch?.updateState!==undefined&&providerStatusIsStale(watch.updateCheckedAt);
 const required=watch?.updateState==="required"&&!stale,noUpdate=watch?.updateState==="not-reported"&&!stale;
 const displayedVersion=watch?.installedVersion||(watch?.installedBuild?((watch.installedBuildSource??"").toUpperCase()+" Build: "+watch.installedBuild):watch?.steamBuildId?"Steam Build ID: "+watch.steamBuildId:null);
 const provider=watch?.updateProvider==="gog"?"GOG":watch?.updateProvider==="epic"?"Epic Games":shop==="steam"?"Steam":null;
 const history=[...(watch?.buildHistory??[]).map(v=>({...v,label:"Steam Build ID"})),...(watch?.platformBuildHistory??[]).map(v=>({...v,label:v.source.toUpperCase()})),...(watch?.localVersionHistory??[]).map(v=>({...v,label:pl?"Lokalna":"Local"}))].sort((a,b)=>Date.parse(b.detectedAt)-Date.parse(a.detectedAt));
 return <section className="krysta-watch krysta-watch--compact">
 <header className="krysta-watch__head"><div className="krysta-watch__status"><span aria-hidden="true" className={"krysta-watch__dot "+(required?"is-required":noUpdate?"is-current":"is-unknown")}/><div><h3>{!ready?(notice?(pl?"Nie udało się sprawdzić":"Check failed"):(pl?"Wykrywanie wersji…":"Detecting version…")):autoChecking?(pl?"Sprawdzanie aktualizacji…":"Checking for updates…"):stale?(pl?"Status wymaga ponownego sprawdzenia":"Status needs rechecking"):required?(pl?"Platforma zgłasza aktualizację":"Provider reports an update"):noUpdate?(pl?"Platforma nie zgłasza aktualizacji":"No update reported by provider"):(pl?"Stan aktualizacji niepotwierdzony":"Update status unconfirmed")}</h3><small>{watch?.updateCheckedAt?(pl?"Status platformy: ":"Provider status: ")+new Date(watch.updateCheckedAt).toLocaleString(i18n.language):watch?.lastChecked?(pl?"Wpisy Steam: ":"Steam posts: ")+new Date(watch.lastChecked).toLocaleString(i18n.language):pl?"Monitor aktualizacji":"Update monitor"}</small></div></div><button type="button" disabled={!ready||busy||autoChecking||!watch} onClick={()=>void checkNow()}>{pl?"Sprawdź teraz":"Check now"}</button></header>
 <div className="krysta-watch__versions"><div><small>{pl?"Zainstalowana wersja":"Installed version"}</small><strong>{displayedVersion??(!ready&&!notice?(pl?"Wykrywanie…":"Detecting…"):(pl?"Nieznana":"Unknown"))}</strong></div><div><small>{pl?"Najnowszy ogłoszony patch":"Latest announced patch"}</small><strong>{watch?.latestVersion??"—"}</strong></div></div>
 {watch?.latestTitle&&<p className="krysta-watch__patch-title">{watch.latestTitle}{watch.latestPublishedAt&&<small> · {new Date(watch.latestPublishedAt).toLocaleDateString(i18n.language)}</small>}</p>}
 {stale&&<small>{pl?"Poprzedni wynik platformy może być nieaktualny; użyj Sprawdź teraz.":"The previous provider result may be outdated; check again."}</small>}
 {watch?.patchHistory&&watch.patchHistory.length>0&&<details><summary>{pl?"Historia ogłoszonych patchy Steam":"Steam patch announcements"} ({watch.patchHistory.length})</summary><ul>{watch.patchHistory.map(p=><li key={p.id}>{new Date(p.publishedAt).toLocaleDateString(i18n.language)} — {p.title}</li>)}</ul><small>{pl?"Ogłoszenie patcha nie jest potwierdzeniem dostępności aktualizacji dla Twojej instalacji.":"A patch announcement does not confirm that an update is available for this installation."}</small></details>}
 {watch?.pendingPatch&&<div className="krysta-watch__actions"><small>{pl?"Nowy wpis: ":"New post: "}{watch.pendingPatch}</small><button type="button" disabled={busy||autoChecking} onClick={()=>{setBusy(true);void window.electron.krystaGameWatchDismiss(shop,id).then(()=>{setWatch(w=>w?{...w,pendingPatch:undefined}:w);window.dispatchEvent(new Event("krysta:patch-badges"));}).catch(e=>setNotice(String(e))).finally(()=>setBusy(false));}}>{pl?"Oznacz jako przeczytany":"Mark as read"}</button></div>}
 {official&&<div className="krysta-watch__actions"><button type="button" disabled={busy||autoChecking||!ready||!watch} onClick={()=>void openClient()}>{required&&shop==="steam"?(pl?"Sprawdź i zaktualizuj w Steam":"Verify and update in Steam"):(pl?"Otwórz klienta":"Open client")}</button>{required&&shop==="steam"&&<small>{pl?"Krysta sprawdzi kopię zapisów. Steam zweryfikuje pliki gry i może zastąpić zmodyfikowane pliki; wynik i pobieranie sprawdź w Steam.":"Krysta checks save protection. Steam will verify game files and may replace modified files; check the result and any downloads in Steam."}</small>}</div>}
 <details><summary>{pl?"Ustawienia i szczegóły":"Settings and details"}</summary><div className="krysta-watch__details">
 <label>{pl?"Monitorowanie":"Monitoring"} <select value={override} disabled={!ready||busy||autoChecking||!watch} onChange={e=>void changeMonitor(e.target.value as "inherit"|"on"|"off")}><option value="inherit">{pl?"Ustawienia globalne":"Global settings"}</option><option value="on">{pl?"Włączone":"Enabled"}</option><option value="off">{pl?"Wyłączone":"Disabled"}</option></select></label>
 <small>{watch?.enabled?(pl?"Monitorowanie aktywne":"Monitoring enabled"):(pl?"Monitorowanie nieaktywne":"Monitoring disabled")}</small>
 {watch?.steamBuildId&&<p>Steam Build ID: {watch.steamBuildId}</p>}
 {provider&&<small>{pl?"Źródło statusu: ":"Status source: "}{provider}</small>}
 {watch?.versionSource&&<small>{pl?"Źródło wersji lokalnej: ":"Local version source: "}{watch.versionSource}</small>}
 {ready&&!autoChecking&&!displayedVersion&&<small>{pl?"Nie odczytano numeru wersji. Sprawdź ścieżkę EXE w ustawieniach gry.":"Version unavailable. Check the executable path in game settings."}</small>}
 <small>{pl?"Status aktualizacji wynika z danych Steam, Epic lub GOG. Ogłoszenie nowego patcha jest niezależne i nie potwierdza dostępności instalatora. Nieobsługiwane gry mają status niepotwierdzony.":"Update status comes from Steam, Epic or GOG. Patch announcements are independent and do not confirm a downloadable update. Unsupported games have an unconfirmed status."}</small>
 <details><summary>{pl?"Historia wykrytych wersji":"Detected version history"} ({history.length})</summary>{history.length?<ul>{history.map((v,i)=><li key={v.detectedAt+":"+i}>{v.label}: {v.from} → {v.to} — {new Date(v.detectedAt).toLocaleString(i18n.language)}</li>)}</ul>:<p>{pl?"Brak wykrytych zmian.":"No detected changes."}</p>}<small>{pl?"Data wykrycia, nie data instalacji.":"Detection date, not installation date."}</small></details>
 <details><summary>{pl?"Integralność plików gry":"Game file integrity"}</summary><div className="krysta-watch__actions">{official&&<button type="button" disabled={busy||autoChecking||!ready||!watch} onClick={()=>void verify("official")}>{pl?"Weryfikuj w kliencie":"Verify in client"}</button>}<button type="button" disabled={busy||autoChecking||!ready||!watch} onClick={()=>void verify("local")}>{pl?"Sprawdź EXE (SHA-256)":"Inspect EXE (SHA-256)"}</button></div><small>{pl?"Suma EXE nie potwierdza integralności całej gry. Oficjalna weryfikacja może zastąpić zmodyfikowane pliki.":"EXE checksum does not validate the whole game. Official verification may replace modified files."}</small>{integrity&&<p role="status" style={{overflowWrap:"anywhere"}}>{integrity}</p>}</details>
 {watch?.error&&<small role="status">{pl?"Nie udało się odświeżyć ogłoszeń o patchach: ":"Could not refresh patch announcements: "}{watch.error}</small>}
 </div></details>
 {notice&&<p role="status" style={{overflowWrap:"anywhere"}}>{notice}</p>}
 </section>;
}
