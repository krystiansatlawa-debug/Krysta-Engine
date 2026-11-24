import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components";

type Entry = { id: string; createdAt: string; files: number; kind?: string; deviceId?: string; location?: "local" | "cloud" | "both" };
function cloudDiagnostic(error:string):string {
  const rules: [RegExp,string][] = [
    [/KRYSTA_INTEGRITY|incomplete cloud save|backup file missing/i,"Kopia jest niekompletna lub uszkodzona. Wybierz wcześniejszą wersję w historii."],
    [/SAVE_CONFLICT/i,"Wykryto konflikt zapisów. Porównaj wersje i wybierz właściwą kopię."],
    [/KRYSTA_NO_SAVE_FILES|no save files detected/i,"Nie wykryto zapisów gry. Uruchom grę, utwórz zapis i zamknij ją przed ponowną próbą."],
    [/invalid_grant|refresh token|401|cannot decrypt cloud credentials/i,"Nie można potwierdzić autoryzacji. Sprawdź połączenie konta w Ustawienia → Krysta Cloud i zaloguj się ponownie, jeśli potrzeba."],
    [/403|permission|forbidden/i,"Brak dostępu lub ograniczenie usługi. Sprawdź uprawnienia konta i dostępne miejsce."],
    [/429|rate limit/i,"Przekroczono limit zapytań. Odczekaj kilka minut i ponów próbę."],
    [/507|quota|storage full|ENOSPC/i,"Brakuje miejsca na dane. Sprawdź wolne miejsce na dysku i w chmurze."],
    [/cloud account changed|cloud provider changed/i,"Zmieniono konto lub dostawcę. Wybierz właściwe konto i ponów operację."],
    [/close the game|KRYSTA_CLOUD_PAUSED/i,"Zamknij grę przed synchronizacją. Game Boost ogranicza operacje w tle."],
    [/timeout|network|fetch failed|offline|502|503|504/i,"Problem z połączeniem lub usługą chmury. Sprawdź internet i spróbuj ponownie."],
    [/save destination not recognized/i,"Nie rozpoznano lokalizacji zapisów. Uruchom grę na tym komputerze i utwórz zapis przed przywracaniem."],
    [/64 MB|too large|exceeds/i,"Kopia przekracza obsługiwany limit rozmiaru. Sprawdź pliki zapisów."]
  ];
  return rules.find(([pattern])=>pattern.test(error))?.[1] ?? "Nie udało się wykonać operacji. Sprawdź ustawienia chmury i ponów próbę.";
}
export function KrystaGameCloud({
  shop,
  objectId,
}: {
  shop: string;
  objectId: string;
}) {
  const { i18n } = useTranslation();
  const pl = i18n.language.startsWith("pl");
  const [cfg, setCfg] = useState<{ provider: string; folder?: string } | null>(
    null
  );
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [phase,setPhase] = useState<"compare"|"backup"|"restore"|"reload"|null>(null);
  const [operations,setOperations] = useState<{at:string;kind:string;result:string}[]>([]);
  const recordOperation = (kind:string,result:string) => {
    setOperations(previous=>[{at:new Date().toISOString(),kind,result},...previous].slice(0,30));
  };
  useEffect(()=>{setOperations([]);},[shop,objectId]);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [comparison, setComparison] = useState<Awaited<
    ReturnType<typeof window.electron.krystaCloudCompare>
  > | null>(null);
  const compare = async () => {
    setPhase("compare");
    setBusy(true);
    setError("");
    try {
      const result = await window.electron.krystaCloudCompare(shop, objectId);
      setComparison(result);
      recordOperation("compare",result.state);
    } catch (e) {
      recordOperation("error","error");
      setError(String(e));
    } finally {
      setBusy(false); setPhase(null);
    }
  };
  const reload = async () => {
    const c = await window.electron.krystaCloudConfig();
    if (c.provider !== "hydra" && (c.provider !== "local" || c.folder))
      setEntries(await window.electron.krystaCloudList(shop, objectId));
    setCfg(c);
  };
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const c = await window.electron.krystaCloudConfig();
        const list =
          c.provider !== "hydra" && (c.provider !== "local" || c.folder)
            ? await window.electron.krystaCloudList(shop, objectId)
            : [];
        if (active) {
          setCfg(c);
          setEntries(list);
        }
      } catch (e) {
        if (active) setError(String(e));
      }
    })();
    return () => {
      active = false;
    };
  }, [shop, objectId]);
  const backup = async () => {
    setPhase("backup");
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (await window.electron.krystaCloudBackup(shop, objectId)) {
        recordOperation("backup","created");
        setPhase("reload");
        await reload();
        setComparison(null);
        setNotice(
          pl
            ? "Kopia utworzona. Sprawdź historię, aby potwierdzić dostępność w chmurze."
            : "Backup created. Check history to confirm cloud availability."
        );
      }
    } catch (e) {
      recordOperation("error","error");
      setError(String(e));
    } finally {
      setBusy(false); setPhase(null);
    }
  };
  const synchronize = async () => {
    if (busy) return;
    setPhase("compare");
    setBusy(true);
    setError("");
    setNotice("");
    setComparison(null);
    try {
      const result = await window.electron.krystaCloudCompare(shop,objectId);
      setComparison(result);
      recordOperation("sync",result.state);
      if (result.state === "same") {
        setNotice(pl ? "Zapisy są już zsynchronizowane." : "Saves are already synchronized.");
        return;
      }
      if (result.state === "different") return;
      if (result.state === "unavailable") {
        setNotice(pl ? "Nie można sprawdzić chmury. Użyj przycisku tworzenia kopii, aby zachować zapisy lokalnie." : "Cloud unavailable. Use Create backup to preserve local saves.");
        return;
      }
      setPhase("backup");
      if (await window.electron.krystaCloudBackup(shop,objectId)) {
        recordOperation("backup","created");
        setPhase("reload");
        await reload();
        setComparison(null);
        setNotice(pl ? "Kopia utworzona. Sprawdź historię, aby potwierdzić dostępność w chmurze." : "Backup created. Check history to confirm cloud availability.");
      }
    } catch(e) { recordOperation("sync","error"); setError(String(e)); }
    finally { setBusy(false); setPhase(null); }
  };
  const restore = async (version: string) => {
    setPhase("restore");
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (await window.electron.krystaCloudRestore(shop, objectId, version)) {
        recordOperation("restore","restored");
        setPhase("reload");
        await reload();
        setNotice(
          pl
            ? "Przywrócono zapisy. Poprzedni stan zachowano w historii kopii."
            : "Saves restored. Previous state preserved in backup history."
        );
      }
    } catch (e) {
      recordOperation("error","error");
      setError(String(e));
    } finally {
      setBusy(false); setPhase(null);
    }
  };
  return (
    <section className="krysta-game-extra">
      <h2>Krysta Cloud</h2>
      {!cfg ? (
        <p>{pl ? "Ładowanie..." : "Loading..."}</p>
      ) : cfg.provider === "hydra" ? (
        <p>
          {pl
            ? "Wybrano Hydra Cloud. Skorzystaj z oryginalnego przycisku zapisów gry lub zmień dostawcę w Ustawienia → Krysta Cloud."
            : "Hydra Cloud selected. Use the original cloud save button or change provider in Settings → Krysta Cloud."}
        </p>
      ) : cfg.provider === "local" && !cfg.folder ? (
        <p>
          {pl
            ? "Wybierz folder w Ustawienia → Krysta Cloud."
            : "Select a folder in Settings → Krysta Cloud."}
        </p>
      ) : (
        <>
          <p>
            {cfg.provider === "google"
              ? "Google Drive"
              : cfg.provider === "synology"
                ? "Synology Drive"
                : pl
                  ? "Folder lokalny"
                  : "Local folder"}
          </p>
          <Button theme="outline" disabled={busy} onClick={() => void synchronize()}>
            {pl ? "Synchronizuj teraz" : "Sync now"}
          </Button>
          <Button theme="outline" disabled={busy} onClick={() => void backup()}>
            {pl ? "Utwórz kopię zapisów" : "Create save backup"}
          </Button>
          <Button
            theme="outline"
            disabled={busy}
            onClick={() => void compare()}
          >
            {pl ? "Sprawdź różnice zapisów" : "Compare saves"}
          </Button>
          {comparison && (
            <div
              role="status"
              style={{
                padding: 14,
                border: "1px solid #555",
                borderRadius: 5,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <strong>
                {comparison.state === "different"
                  ? pl
                    ? "Konflikt zapisów"
                    : "Save conflict"
                  : comparison.state === "same"
                    ? pl
                      ? "Zapisy są identyczne"
                      : "Saves match"
                    : comparison.state === "no-backup"
                      ? pl
                        ? "Brak kopii w chmurze"
                        : "No cloud backup"
                      : pl
                        ? "Nie można zweryfikować zapisów"
                        : "Unable to verify saves"}
              </strong>
              <p>
                {pl ? "Lokalne pliki" : "Local files"}: {comparison.localFiles}{" "}
                · {pl ? "Pliki w chmurze" : "Cloud files"}:{" "}
                {comparison.cloudFiles}
              </p>
              {comparison.createdAt && (
                <p>
                  {pl ? "Data kopii" : "Backup date"}:{" "}
                  {new Date(comparison.createdAt).toLocaleString(i18n.language)}
                </p>
              )}
              {comparison.state === "different" && (
                <>
                  <p>
                    {pl
                      ? "Wybierz wersję. Poprzednie kopie pozostaną w historii."
                      : "Choose a version. Previous backups remain in history."}
                  </p>
                  <Button
                    theme="outline"
                    disabled={busy}
                    onClick={() => void backup()}
                  >
                    {pl
                      ? "Zachowaj lokalne jako nową kopię"
                      : "Keep local as new backup"}
                  </Button>
                  {comparison.version && (
                    <Button
                      theme="outline"
                      disabled={busy}
                      onClick={() => void restore(comparison.version!)}
                    >
                      {pl ? "Przywróć kopię z chmury" : "Restore cloud backup"}
                    </Button>
                  )}
                  <Button theme="outline" onClick={() => setComparison(null)}>
                    {pl ? "Anuluj" : "Cancel"}
                  </Button>
                </>
              )}
            </div>
          )}
          <h3>{pl ? "Ostatnie operacje w tej sesji" : "Recent operations this session"}</h3>
          {operations.length === 0 ? <p>{pl ? "Brak operacji." : "No operations."}</p> : operations.map((op,index)=>(
            <p key={op.at+index}>{new Date(op.at).toLocaleString(i18n.language)} · {pl ? ({compare:"Porównanie",sync:"Synchronizacja",backup:"Kopia",restore:"Przywracanie",error:"Operacja"} as Record<string,string>)[op.kind] : op.kind} · {pl ? ({same:"Zgodne",different:"Konflikt",unavailable:"Niedostępne","no-backup":"Brak kopii",created:"Utworzona (sprawdź lokalizację w historii)",restored:"Przywrócono",error:"Błąd"} as Record<string,string>)[op.result] : op.result}</p>
          ))}
          <h3>
            {pl
              ? "Historia wersji zapisów"
              : "Save version history"}
          </h3>
          {!entries.length ? (
            <p>{pl ? "Brak kopii." : "No backups."}</p>
          ) : (
            entries.map((e) => (
              <div
                key={e.id}
                style={{
                  padding: 12,
                  border: "1px solid #444",
                  borderRadius: 5,
                }}
              >
                {new Date(e.createdAt).toLocaleString(i18n.language)} ·{" "}
                {e.files} {pl ? "plików" : "files"}{" "}
                <p>
                  {e.kind === "automatic" ? (pl ? "Automatyczna" : "Automatic") :
                    e.kind === "manual" ? (pl ? "Ręczna" : "Manual") :
                    e.kind === "pre-update" ? (pl ? "Przed aktualizacją" : "Before update") :
                    e.kind === "before-restore" ? (pl ? "Przed przywróceniem" : "Before restore") :
                    (pl ? "Starsza kopia" : "Legacy backup")}
                  {" · "}
                  {e.location === "both" ? (pl ? "Lokalnie i w chmurze" : "Local and cloud") :
                    e.location === "cloud" ? (pl ? "Chmura" : "Cloud") :
                    e.location === "local" ? (pl ? "Lokalnie" : "Local") : (pl ? "Nieznane źródło" : "Unknown source")}
                  {e.deviceId && (" · " + (pl ? "Urządzenie " : "Device ") + e.deviceId.slice(0,8))}
                </p>
                <Button
                  theme="outline"
                  disabled={busy}
                  onClick={() => void restore(e.id)}
                >
                  {pl ? "Przywróć" : "Restore"}
                </Button>
              </div>
            ))
          )}
        </>
      )}
      {busy && phase && (
        <div role="status" aria-live="polite" style={{display:"flex",flexDirection:"column",gap:8}}>
          <span>{pl ? ({compare:"Sprawdzanie zapisów…",backup:"Tworzenie kopii i synchronizacja…",restore:"Przywracanie zapisów…",reload:"Odświeżanie historii…"})[phase] : ({compare:"Checking saves…",backup:"Creating backup and syncing…",restore:"Restoring saves…",reload:"Refreshing history…"})[phase]}</span>
          <progress aria-label={pl ? "Operacja chmury w toku" : "Cloud operation in progress"} style={{width:"100%"}} />
          <small>{pl ? "Poczekaj na zakończenie operacji." : "Wait for the operation to finish."}</small>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <div role="alert" style={{overflowWrap:"anywhere"}}>
          <strong>{pl ? "Diagnostyka chmury" : "Cloud diagnostics"}</strong>
          <p>{pl ? cloudDiagnostic(error) : "Cloud operation failed. Check your cloud settings and retry."}</p>
          <details><summary>{pl ? "Szczegóły techniczne" : "Technical details"}</summary><p>{error.replace(/(Bearer\s+)[^\s]+/gi,"$1[ukryto]").replace(/((?:access_token|refresh_token|client_secret|password)[=:]\s*)[^\s&,]+/gi,"$1[ukryto]")}</p></details>
        </div>
      )}
    </section>
  );
}
