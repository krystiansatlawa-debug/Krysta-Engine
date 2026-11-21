import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, Image as ImageIcon, RefreshCw } from "lucide-react";
import type { LocalScreenshot } from "@types";
import { toLocalScreenshotUrl } from "@shared";
import { GalleryLightbox } from "../game-details/gallery-slider/gallery-lightbox";
import type { GalleryMediaItem } from "../game-details/gallery-slider/gallery-slider";
import "./krysta-screenshots.scss";

type Souvenir = Awaited<
  ReturnType<typeof window.electron.getKrystaSouvenirGallery>
>[number];
type GalleryEntry = {
  id: string;
  gameTitle: string;
  path: string;
  previewPath: string;
  capturedAt: number;
  kind: "manual" | "achievement";
  achievementNames: string[];
};
const PAGE_SIZE = 80;
export default function KrystaScreenshots() {
  const { i18n } = useTranslation();
  const pl = i18n.language.startsWith("pl");
  const [items, setItems] = useState<LocalScreenshot[]>([]);
  const [souvenirs, setSouvenirs] = useState<Souvenir[]>([]);
  const [kindFilter, setKindFilter] = useState<
    "all" | "manual" | "achievement"
  >("all");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState("");
  const [gameFilter, setGameFilter] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const revision = useRef(0);
  const mounted = useRef(true);
  const reload = useCallback(async () => {
    const started = revision.current;
    try {
      const [latest, achievements] = await Promise.all([
        window.electron.getLocalScreenshots(),
        window.electron.getKrystaSouvenirGallery(),
      ]);
      if (!mounted.current || started !== revision.current) return;
      setItems(latest);
      setSouvenirs(achievements);
      setError("");
    } catch (e) {
      if (mounted.current && started === revision.current) setError(String(e));
    } finally {
      if (mounted.current && started === revision.current) setLoaded(true);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    // Subscribe first, so an older pending read cannot overwrite live changes.
    const stop = window.electron.onLocalScreenshotsChange((next) => {
      revision.current++;
      setItems(next);
      // Drop previously indexed souvenirs immediately on account changes, then
      // recheck ownership via the main process before displaying them again.
      setSouvenirs([]);
      setLoaded(true);
      setError("");
      void reload();
    });
    void reload();
    const refresh = () => {
      if (!document.hidden) void reload();
    };
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      mounted.current = false;
      revision.current++;
      stop();
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [reload]);
  const entries = useMemo<GalleryEntry[]>(() => {
    const byPath = new Map<string, GalleryEntry>();
    for (const local of items) {
      const identity = local.path.toLocaleLowerCase();
      if (byPath.has(identity)) continue;
      byPath.set(identity, {
        id: "manual:" + local.clientId,
        gameTitle: local.gameTitle,
        path: local.path,
        previewPath: local.previewPath ?? local.path,
        capturedAt: local.capturedAt,
        kind: "manual",
        achievementNames: [],
      });
    }
    for (const item of souvenirs) {
      const identity = item.path.toLocaleLowerCase();
      const existing = byPath.get(identity);
      if (existing) {
        // Keep a single tile when a capture is registered as both a private
        // image and an achievement souvenir.
        existing.kind = "achievement";
        existing.achievementNames = item.achievementNames;
        continue;
      }
      byPath.set(identity, {
        id: "achievement:" + item.id,
        gameTitle: item.gameTitle,
        path: item.path,
        previewPath: item.path,
        capturedAt: item.capturedAt,
        kind: "achievement",
        achievementNames: item.achievementNames,
      });
    }
    return [...byPath.values()].sort((a, b) => b.capturedAt - a.capturedAt);
  }, [items, souvenirs]);
  const games = useMemo(
    () =>
      [...new Set(entries.map((e) => e.gameTitle).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b, i18n.language)
      ),
    [entries, i18n.language]
  );
  const filtered = useMemo(
    () =>
      entries.filter(
        (s) =>
          (kindFilter === "all" || s.kind === kindFilter) &&
          (!gameFilter || s.gameTitle === gameFilter) &&
          (!search ||
            (s.gameTitle + " " + s.achievementNames.join(" "))
              .toLocaleLowerCase()
              .includes(search.toLocaleLowerCase()))
      ),
    [entries, kindFilter, gameFilter, search]
  );
  const folders = useMemo(() => {
    const grouped = new Map<string, { gameTitle: string; count: number; previewPath: string }>();
    for (const entry of filtered) {
      const key = entry.gameTitle || (pl ? "Nieprzypisane" : "Unassigned");
      const folder = grouped.get(key);
      if (folder) folder.count++;
      else grouped.set(key, { gameTitle: key, count: 1, previewPath: entry.previewPath });
    }
    return [...grouped.values()].sort((a, b) => a.gameTitle.localeCompare(b.gameTitle, i18n.language));
  }, [filtered, i18n.language, pl]);
  const shown = filtered.slice(0, limit);
  const media = useMemo<GalleryMediaItem[]>(
    () =>
      filtered.map((s) => ({
        id: s.id,
        type: "image" as const,
        src: toLocalScreenshotUrl(s.path),
        thumbnail: toLocalScreenshotUrl(s.previewPath),
        alt:
          s.gameTitle +
          " – " +
          new Date(s.capturedAt).toLocaleString(i18n.language),
      })),
    [filtered, i18n.language]
  );
  const activeIndex = selectedId
    ? media.findIndex((m) => m.id === selectedId)
    : -1;
  const folder = async () => {
    try {
      await window.electron.openScreenshotsFolder();
    } catch (e) {
      setError(String(e));
    }
  };
  const importPrivateFolder = async () => {
    setImporting(true);
    setImportMessage("");
    setError("");
    try {
      const result = await window.electron.selectPrivateScreenshotsFolder();
      if (!result) return;
      await reload();
      setImportMessage(
        pl
          ? `Zaimportowano ${result.imported} nowych zdjęć. Folder jest zapamiętany.`
          : `Imported ${result.imported} new photos. The folder is remembered.`
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setImporting(false);
    }
  };
  return (
    <main className="krysta-screenshots">
      <header className="krysta-screenshots__header">
        <ImageIcon size={26} />
        <div>
          <h1>{pl ? "Zrzuty ekranu" : "Screenshots"}</h1>
          <small>
            {pl
              ? "Twoje zdjęcia z gier i osiągnięć"
              : "Your game and achievement screenshots"}{" "}
            · {entries.length}
          </small>
        </div>
        <div className="krysta-screenshots__buttons">
          <button type="button" onClick={() => void reload()}>
            <RefreshCw size={16} />
            {pl ? "Odśwież" : "Refresh"}
          </button>
          <button type="button" onClick={() => void folder()}>
            <FolderOpen size={16} />
            {pl ? "Otwórz folder" : "Open folder"}
          </button>
          <button type="button" disabled={importing} onClick={() => void importPrivateFolder()}>
            <FolderOpen size={16} />
            {pl ? "Dodaj prywatny folder" : "Add private folder"}
          </button>
        </div>
      </header>
      <div className="krysta-screenshots__filters">
        <input
          aria-label={pl ? "Szukaj gry" : "Search game"}
          placeholder={pl ? "Szukaj gry…" : "Search game…"}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setLimit(PAGE_SIZE);
          }}
        />
        <select
          aria-label={pl ? "Rodzaj zrzutów" : "Screenshot type"}
          value={kindFilter}
          onChange={(e) => {
            setKindFilter(e.target.value as "all" | "manual" | "achievement");
            setLimit(PAGE_SIZE);
          }}
        >
          <option value="all">{pl ? "Wszystkie zdjęcia" : "All images"}</option>
          <option value="manual">{pl ? "Z gry" : "Game captures"}</option>
          <option value="achievement">
            {pl ? "Z osiągnięć" : "Achievement captures"}
          </option>
        </select>
        <select
          aria-label={pl ? "Filtruj według gry" : "Filter by game"}
          value={gameFilter}
          onChange={(e) => {
            setGameFilter(e.target.value);
            setLimit(PAGE_SIZE);
          }}
        >
          <option value="">{pl ? "Wszystkie gry" : "All games"}</option>
          {games.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </div>
      {importMessage && <p role="status">{importMessage}</p>}
      {error && <p role="alert">{error}</p>}
      {!loaded ? (
        <p role="status">
          {pl ? "Wczytywanie zrzutów…" : "Loading screenshots…"}
        </p>
      ) : filtered.length === 0 ? (
        <p>
          {pl
            ? "Brak zapisanych zdjęć w tej kategorii. Pamiątki osiągnięć wymagają włączenia tej funkcji i mogą być dostępne tylko przy aktywnej subskrypcji."
            : "No saved images in this category. Achievement souvenirs need to be enabled and may require an active subscription."}
        </p>
      ) : !gameFilter && !search.trim() ? (
        <section className="krysta-screenshots__folders" aria-label={pl ? "Foldery gier" : "Game folders"}>
          {folders.map((folder) => (
            <button key={folder.gameTitle} type="button" className="krysta-screenshots__folder" onClick={() => { setGameFilter(folder.gameTitle); setLimit(PAGE_SIZE); }}>
              <img src={toLocalScreenshotUrl(folder.previewPath)} alt="" loading="lazy" />
              <span className="krysta-screenshots__folder-title"><FolderOpen size={17} /><strong>{folder.gameTitle}</strong></span>
              <small>{pl ? "Zdjęcia" : "Images"}: {folder.count}</small>
            </button>
          ))}
        </section>
      ) : (
        <>
          {gameFilter && <button type="button" className="krysta-screenshots__back" onClick={() => { setGameFilter(""); setLimit(PAGE_SIZE); }}>
            <FolderOpen size={16} />{pl ? "Wszystkie foldery gier" : "All game folders"}
          </button>}
          <section
            className="krysta-screenshots__grid"
            aria-label={pl ? "Galeria zrzutów ekranu" : "Screenshot gallery"}
          >
            {shown.map((s) => (
              <button
                key={s.id}
                type="button"
                className="krysta-screenshots__tile"
                onClick={() => setSelectedId(s.id)}
              >
                <img
                  src={toLocalScreenshotUrl(s.previewPath ?? s.path)}
                  alt={s.gameTitle}
                  loading="lazy"
                />
                <strong title={s.gameTitle}>{s.gameTitle}</strong>
                <small className="krysta-screenshots__kind">
                  {s.kind === "achievement"
                    ? pl
                      ? "Osiągnięcie"
                      : "Achievement"
                    : pl
                      ? "Zrzut z gry"
                      : "Game screenshot"}
                  {s.achievementNames.length
                    ? " · " + s.achievementNames.join(", ")
                    : ""}
                </small>
                <small>
                  {new Date(s.capturedAt).toLocaleString(i18n.language)}
                </small>
              </button>
            ))}
          </section>
        </>
      )}
      {filtered.length > shown.length && (
        <button
          className="krysta-screenshots__more"
          type="button"
          onClick={() => setLimit((n) => n + PAGE_SIZE)}
        >
          {pl ? "Pokaż więcej" : "Show more"} ({filtered.length - shown.length})
        </button>
      )}
      {activeIndex >= 0 && (
        <GalleryLightbox
          visible
          items={media}
          index={activeIndex}
          onClose={() => setSelectedId(null)}
          onNavigate={(i) => setSelectedId(media[i]?.id ?? null)}
          showFilmstrip={false}
          trapFocus
        />
      )}
    </main>
  );
}
