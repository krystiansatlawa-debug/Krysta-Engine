import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRightIcon } from "@primer/octicons-react";
import Skeleton from "react-loading-skeleton";

import { Button, Hero } from "@renderer/components";
import { clearFilters, setFilters, setMode } from "@renderer/features";
import { catalogueSearchSlice } from "@renderer/features/catalogue-search";
import { buildGameDetailsPath, ensureArray } from "@renderer/helpers";
import { useAppDispatch, useAppSelector } from "@renderer/hooks";
import { levelDBService } from "@renderer/services/leveldb.service";
import { CatalogueCategory } from "@shared";
import type {
  CatalogueSearchPayload,
  CatalogueSearchResult,
  DownloadSource,
  ShopAssets,
  Steam250Game,
  TrendingGame,
  ShopDetailsWithAssets,
} from "@types";

import { uniqueCatalogueGames } from "@shared/catalogue-unique-games";
import { CataloguePersonalization } from "./catalogue-personalization";
import { CatalogueCategories } from "./catalogue-categories";
import { CatalogueWishlistButton } from "./catalogue-wishlist";

const newest = { sortBy: "releaseDate", sortOrder: "desc" } as const;
const shelves = [
  { id: CatalogueCategory.Hot, label: "catalogue_trending" },
  { id: "new", label: "catalogue_new" },
  { id: CatalogueCategory.Weekly, label: "catalogue_weekly" },
  { id: CatalogueCategory.Achievements, label: "catalogue_achievements" },
  { id: "rated", label: "rated" },
  { id: "rising", label: "rising" },
] as const;
type ShelfId = (typeof shelves)[number]["id"];
type ShelfGames = (ShopAssets | CatalogueSearchResult)[];
type ShelfResults = Partial<Record<ShelfId, ShelfGames | null>>;

const shelfSize = 10;

export default function CatalogueDiscover() {
  const { t, i18n } = useTranslation("home");
  const pl = i18n.language.startsWith("pl");
  const [recent, setRecent] = useState<ShelfGames>(() => { try { const data = JSON.parse(localStorage.getItem("krysta-catalogue-recent") ?? "[]"); return Array.isArray(data) ? data.filter(g => g && typeof g.title === "string" && typeof g.shop === "string" && typeof g.objectId === "string").slice(0, 12) : []; } catch { return []; } });
  const remember = (game: ShelfGames[number]) => {
    setRecent(current => { const next = [game, ...current.filter(g => g.shop !== game.shop || g.objectId !== game.objectId)].slice(0, 12); try { localStorage.setItem("krysta-catalogue-recent", JSON.stringify(next)); } catch {} return next; });
  };
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const library = useAppSelector(state => state.library.value);
  const owned = useMemo(() => new Set(library.filter(g => !g.isDeleted).flatMap(g => [`${g.shop}:${g.objectId}`, ...(g.catalogueGame ? [`${g.catalogueGame.shop}:${g.catalogueGame.objectId}`] : [])])), [library]);
  const mode = useAppSelector((state) => state.catalogueSearch.mode);
  const [results, setResults] = useState<ShelfResults>({});
  const [attempt, setAttempt] = useState(0);
  const [visible, setVisible] = useState(() => !document.hidden);
  const [recentLimit, setRecentLimit] = useState(6);
  useEffect(() => { const change = () => setVisible(!document.hidden); document.addEventListener("visibilitychange",change); return () => document.removeEventListener("visibilitychange",change); }, []);
  useEffect(() => { if (!visible) return; const timer = window.setInterval(() => setAttempt(value=>value+1), 5*60*1000); return () => window.clearInterval(timer); }, [visible]);
  const [activeShelf, setActiveShelf] = useState<ShelfId>(
    CatalogueCategory.Hot
  );
  const [hoveredGame, setHoveredGame] = useState<string>();
  const [randomGame, setRandomGame] = useState<Steam250Game | null>(null);

  useEffect(() => {
    if (!visible) return;
    let active = true;

    const loadShelves = async () => {
      const sources = (await levelDBService
        .values("downloadSources")
        .catch(() => [])) as DownloadSource[];
      if (!active) return;

      const pagination = {
        take: shelfSize,
        skip: 0,
        downloadSourceIds: sources.map(({ id }) => id),
      };

      await Promise.all(
        shelves.filter(({ id }) => id !== "rising").map(async ({ id }) => {
          let games: ShelfGames | null;
          try {
            if (id === "new" || id === "rated") {
              const path = "/catalogue/search";
              const response = await window.electron.hydraApi.post<{
                edges: CatalogueSearchResult[];
              }>(path, {
                data: {
                  ...catalogueSearchSlice.getInitialState().filters,
                  ...pagination,
                  ...(id === "rated" ? { sortBy: "reviewScore", sortOrder: "desc" } : newest),
                },
                needsAuth: false,
              });
              games = ensureArray(response?.edges, path);
            } else {
              const path = `/catalogue/${id}`;
              const response = await window.electron.hydraApi.get<ShopAssets[]>(
                path,
                {
                  params: pagination,
                  needsAuth: false,
                }
              );
              games = ensureArray(response, path);
            }
          } catch {
            games = null;
          }

          if (active) setResults((current) => ({ ...current, [id]: games === null ? current[id] ?? null : uniqueCatalogueGames(games, shelfSize) }));
        })
      );
    };

    void loadShelves();
    return () => {
      active = false;
    };
  }, [attempt, visible]);

  useEffect(() => {
    let active = true;
    window.electron
      .getRandomGame()
      .then((game) => {
        if (active && game) setRandomGame(game);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const openResults = (filters: Partial<CatalogueSearchPayload>) => {
    if (mode !== "modern") dispatch(setMode("modern"));
    dispatch(clearFilters());
    dispatch(setFilters(filters));
    navigate("/catalogue/search");
  };

  const rising = useMemo(() => {
    const hot = results[CatalogueCategory.Hot];
    const weekly = results[CatalogueCategory.Weekly];
    if (hot === null || weekly === null) return null;
    if (!hot || !weekly) return undefined;
    const ranks = new Map(weekly.map((game, index) => [`${game.shop}:${game.objectId}`, index]));
    return hot.map((game, index) => ({ game, gain: (ranks.get(`${game.shop}:${game.objectId}`) ?? weekly.length) - index }))
      .filter(entry => entry.gain > 0).sort((a, b) => b.gain - a.gain).map(entry => entry.game);
  }, [results]);
  const games = activeShelf === "rising" ? rising : results[activeShelf];
  const allGames = useMemo(
    () => Object.values(results).flatMap((games) => games ?? []),
    [results]
  );
  const alternatives = useMemo(
    () =>
      (results[CatalogueCategory.Hot] ?? []).flatMap((game): TrendingGame[] =>
        "libraryHeroImageUrl" in game
          ? [{ ...game, description: null, uri: buildGameDetailsPath(game) }]
          : []
      ),
    [results]
  );
  const gameKey = (game: ShelfGames[number]) => `${game.shop}:${game.objectId}`;
  const preview =
    games?.find((game) => gameKey(game) === hoveredGame) ?? games?.[0];

  const [previewDetails, setPreviewDetails] = useState<{key: string; data: ShopDetailsWithAssets}>();
  const previewShop = preview?.shop;
  const previewId = preview?.objectId;
  const previewKey = preview ? gameKey(preview) : "";
  useEffect(() => {
    if (!visible || !previewShop || !previewId || !hoveredGame) return;
    let active = true;
    const timer = window.setTimeout(() => {
      if (document.hidden) return;
      window.electron.getGameShopDetails(previewId, previewShop, i18n.language.split("-")[0]).then(data => {
        if (active && data) setPreviewDetails({key: previewKey, data});
      }).catch(() => {});
    }, 350);
    return () => { active = false; window.clearTimeout(timer); };
  }, [previewShop, previewId, previewKey, hoveredGame, i18n.language, visible]);
  const screenshots = previewDetails?.key === previewKey ? previewDetails.data.screenshots?.slice(0, 3) : undefined;
  return (
    <section className="catalogue-discover">
      <Hero alternatives={alternatives} onView={remember} />

      <section
        className="catalogue-discover__shelf catalogue-store-width"
        aria-busy={games === undefined}
      >
        <div className="catalogue-discover__shelf-picker">
          {shelves.map(({ id, label }) => (
            <button
              type="button"
              key={id}
              aria-pressed={activeShelf === id}
              onClick={() => {
                setActiveShelf(id);
                setHoveredGame(undefined);
              }}
            >
              {id === "rated" ? (pl ? "Najwyżej oceniane" : "Top rated") : id === "rising" ? (pl ? "Zyskujące popularność" : "Rising") : t(label)}
            </button>
          ))}
        </div>

        {activeShelf === "rising" && <small>{pl ? "Porównanie pozycji na aktualnej i tygodniowej liście popularności (nie pomiar wzrostu liczby graczy)." : "Current versus weekly popularity rank (not player count growth)."}</small>}
        {games === null ? (
          <div className="catalogue-discover__status" role="status">
            <p>{t("browse_load_error")}</p>
            <Button
              theme="outline"
              size="small"
              onClick={() => {
                setResults((current) => ({
                  ...current,
                  [activeShelf]: undefined,
                }));
                setAttempt((current) => current + 1);
              }}
            >
              {t("browse_retry")}
            </Button>
          </div>
        ) : games?.length === 0 ? (
          <p role="status">{t("no_results")}</p>
        ) : (
          <div className="catalogue-discover__shelf-body">
            <div className="catalogue-discover__games">
              {games
                ? games.map((game) => (
                    <article
                      className="catalogue-discover__game"
                      key={gameKey(game)}
                      data-highlighted={preview === game}
                    >
                      <Link
                        to={buildGameDetailsPath(game)}
                        onClick={() => remember(game)}
                        onPointerEnter={() => setHoveredGame(gameKey(game))}
                        onFocus={() => setHoveredGame(gameKey(game))}
                      >
                        {game.libraryImageUrl && (
                          <img
                            src={game.libraryImageUrl}
                            alt=""
                            loading="lazy" decoding="async"
                          />
                        )}
                        <span>
                          <strong>{game.title}</strong>
                          {owned.has(gameKey(game)) && <small>{pl ? "W bibliotece" : "In library"}</small>}
                          {"genres" in game && game.genres?.length > 0 && (
                            <small>{game.genres.slice(0, 3).join(", ")}</small>
                          )}
                        </span>
                      </Link>
                      <CatalogueWishlistButton game={game} />
                    </article>
                  ))
                : Array.from({ length: shelfSize }, (_, index) => (
                    <Skeleton
                      key={index}
                      className="catalogue-discover__placeholder"
                    />
                  ))}
            </div>
            {preview && (
              <aside className="catalogue-discover__preview">
                <Link to={buildGameDetailsPath(preview)} onClick={() => remember(preview)}>
                  <strong>{preview.title}</strong>
                  {"genres" in preview && preview.genres?.length > 0 && (
                    <div className="catalogue-discover__preview-genres">
                      {preview.genres.slice(0, 4).map((genre) => (
                        <span key={genre}>{genre}</span>
                      ))}
                    </div>
                  )}
                  {screenshots?.length ? screenshots.map(screen => <img key={screen.id} src={screen.path_thumbnail} alt="" loading="lazy" />) : null}
                  {preview.libraryImageUrl && (
                    <img src={preview.libraryImageUrl} alt="" loading="lazy" />
                  )}
                </Link>
              </aside>
            )}
          </div>
        )}

        {activeShelf === "rated" && <Button theme="outline" size="small" onClick={() => openResults({sortBy: "reviewScore", sortOrder: "desc"})}>{pl ? "Zobacz wszystkie" : "View all"}</Button>}
        {activeShelf === "new" && <Link to="/catalogue/releases">{pl ? "Kalendarz premier" : "Release calendar"}</Link>}
        {activeShelf === CatalogueCategory.Hot && <Link to="/catalogue/top">{pl ? "Ranking popularności" : "Popularity ranking"}</Link>}
        {activeShelf === "new" && games && (
          <Button
            theme="outline"
            size="small"
            className="catalogue-discover__browse-more"
            onClick={() => openResults(newest)}
          >
            {t("browse_all_new")} <ArrowRightIcon />
          </Button>
        )}
      </section>

      <CataloguePersonalization />
      {recent.length > 0 && <section className="catalogue-discover__shelf catalogue-store-width">
        <header className="catalogue-discover__heading"><h2>{pl ? "Ostatnio przeglądane" : "Recently viewed"}</h2><Button theme="outline" size="small" onClick={() => { setRecent([]); try { localStorage.removeItem("krysta-catalogue-recent"); } catch {} }}>{pl ? "Wyczyść" : "Clear"}</Button></header>
        <div className="catalogue-discover__games">{recent.slice(0,recentLimit).map(game => <article className="catalogue-discover__game" key={gameKey(game)}><Link to={buildGameDetailsPath(game)} onClick={() => remember(game)}>{game.libraryImageUrl && <img src={game.libraryImageUrl} alt="" loading="lazy" />}<span><strong>{game.title}</strong></span></Link></article>)}</div>
        {recent.length > recentLimit && <Button theme="outline" size="small" onClick={()=>setRecentLimit(v=>v+6)}>{pl?"Pokaż więcej":"Show more"}</Button>}
      </section>}
      <section className="catalogue-discover__browse catalogue-store-width">
        <header className="catalogue-discover__heading">
          <h2>{t("browse_games")}</h2>
          {randomGame && (
            <Button
              theme="outline"
              size="small"
              onClick={() =>
                navigate(
                  buildGameDetailsPath(
                    { ...randomGame, shop: "steam" },
                    { fromRandomizer: "1" }
                  )
                )
              }
            >
              {t("surprise_me")}
            </Button>
          )}
        </header>
        <CatalogueCategories
          artworkForGenre={(genre) =>
            allGames.find(
              (game) =>
                "genres" in game &&
                game.genres?.includes(genre) &&
                game.libraryImageUrl
            )?.libraryImageUrl
          }
          onChooseGenre={(genre) => openResults({ genres: [genre] })}
          onChooseTag={(id) => openResults({ tags: [id] })}
        />
      </section>
    </section>
  );
}
