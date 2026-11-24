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
} from "@types";

import { CatalogueCategories } from "./catalogue-categories";
import { CatalogueWishlistButton } from "./catalogue-wishlist";

const newest = { sortBy: "releaseDate", sortOrder: "desc" } as const;
const shelves = [
  { id: CatalogueCategory.Hot, label: "catalogue_trending" },
  { id: "new", label: "catalogue_new" },
  { id: CatalogueCategory.Weekly, label: "catalogue_weekly" },
  { id: CatalogueCategory.Achievements, label: "catalogue_achievements" },
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
  const mode = useAppSelector((state) => state.catalogueSearch.mode);
  const [results, setResults] = useState<ShelfResults>({});
  const [attempt, setAttempt] = useState(0);
  const [activeShelf, setActiveShelf] = useState<ShelfId>(
    CatalogueCategory.Hot
  );
  const [hoveredGame, setHoveredGame] = useState<string>();
  const [randomGame, setRandomGame] = useState<Steam250Game | null>(null);

  useEffect(() => {
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
        shelves.map(async ({ id }) => {
          let games: ShelfGames | null;
          try {
            if (id === "new") {
              const path = "/catalogue/search";
              const response = await window.electron.hydraApi.post<{
                edges: CatalogueSearchResult[];
              }>(path, {
                data: {
                  ...catalogueSearchSlice.getInitialState().filters,
                  ...pagination,
                  ...newest,
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

          if (active) setResults((current) => ({ ...current, [id]: games }));
        })
      );
    };

    void loadShelves();
    return () => {
      active = false;
    };
  }, [attempt]);

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

  const games = results[activeShelf];
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

  return (
    <section className="catalogue-discover">
      <Hero alternatives={alternatives} />

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
              {t(label)}
            </button>
          ))}
        </div>

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
                            loading="lazy"
                          />
                        )}
                        <span>
                          <strong>{game.title}</strong>
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
                  {preview.libraryImageUrl && (
                    <img src={preview.libraryImageUrl} alt="" loading="lazy" />
                  )}
                </Link>
              </aside>
            )}
          </div>
        )}

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

      {recent.length > 0 && <section className="catalogue-discover__shelf catalogue-store-width">
        <header className="catalogue-discover__heading"><h2>{pl ? "Ostatnio przeglądane" : "Recently viewed"}</h2><Button theme="outline" size="small" onClick={() => { setRecent([]); try { localStorage.removeItem("krysta-catalogue-recent"); } catch {} }}>{pl ? "Wyczyść" : "Clear"}</Button></header>
        <div className="catalogue-discover__games">{recent.map(game => <article className="catalogue-discover__game" key={gameKey(game)}><Link to={buildGameDetailsPath(game)} onClick={() => remember(game)}>{game.libraryImageUrl && <img src={game.libraryImageUrl} alt="" loading="lazy" />}<span><strong>{game.title}</strong></span></Link></article>)}</div>
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
