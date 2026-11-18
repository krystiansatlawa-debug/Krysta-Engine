import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components";

type Entry = { id: string; createdAt: string; files: number };
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
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [comparison, setComparison] = useState<Awaited<
    ReturnType<typeof window.electron.krystaCloudCompare>
  > | null>(null);
  const compare = async () => {
    setBusy(true);
    setError("");
    try {
      setComparison(await window.electron.krystaCloudCompare(shop, objectId));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
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
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (await window.electron.krystaCloudBackup(shop, objectId)) {
        await reload();
        setComparison(null);
        setNotice(
          pl
            ? "Kopia zapisana w wybranym miejscu."
            : "Backup saved to selected destination."
        );
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const restore = async (version: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (await window.electron.krystaCloudRestore(shop, objectId, version)) {
        await reload();
        setNotice(
          pl
            ? "Przywrócono zapisy. Poprzedni stan zachowano w historii kopii."
            : "Saves restored. Previous state preserved in backup history."
        );
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
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
          <h3>
            {pl
              ? "Historia kopii na tym komputerze"
              : "Backup history on this computer"}
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
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" style={{ overflowWrap: "anywhere" }}>
          {error}
        </p>
      )}
    </section>
  );
}
