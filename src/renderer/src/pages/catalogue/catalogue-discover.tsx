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
import { gameGenres } from "./browse-categories";
import { CatalogueWishlistButton } from "./catalogue-wishlist";

const newest = { sortBy: "releaseDate", sortOrder: "desc" } as const;
const shelves = [
  { id: CatalogueCategory.Hot, label: "catalogue_trending" },
  { id: "new", label: "catalogue_new" },
  { id: "upcoming", label: "catalogue_upcoming" },
  { id: CatalogueCategory.Weekly, label: "catalogue_weekly" },
  { id: CatalogueCategory.Achievements, label: "catalogue_achievements" },
] as const;
type ShelfId = (typeof shelves)[number]["id"];
type SteamShelfGame = { shop: "steam"; objectId: string; title: string; libraryImageUrl: string; steamOnly: true };
type ShelfGames = (ShopAssets | CatalogueSearchResult | SteamShelfGame)[];
type ShelfResults = Partial<Record<ShelfId, ShelfGames | null>>;

const shelfSize = 10;

export default function CatalogueDiscover() {
  const { t, i18n } = useTranslation("home");
  const pl = i18n.language.startsWith("pl");
  const [steam, setSteam] = useState<Awaited<ReturnType<typeof window.electron.getKrystaSteamCatalogue>>>(null);

  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const mode = useAppSelector((state) => state.catalogueSearch.mode);
  const [results, setResults] = useState<ShelfResults>({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (document.hidden) return;
      try {
        const result = await window.electron.getKrystaSteamCatalogue();
        if (active && result) setSteam(result);
      } catch { /* Existing catalogue remains available. */ }
    };
    void refresh();
    const timer = window.setInterval(refresh, 30 * 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [attempt]);
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
          if (id === "upcoming") return;
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

  const games = useMemo(() => {
    const direct = activeShelf === "new" ? steam?.newReleases : activeShelf === "upcoming" ? steam?.upcoming : undefined;
    if (!direct) return activeShelf === "upcoming" ? (steam ? [] : null) : results[activeShelf];
    const existing = results[activeShelf] ?? [];
    const byKey = new Map(existing.map(game => [`${game.shop}:${game.objectId}`, game]));
    const merged: ShelfGames = direct.map(game => byKey.get("steam:" + game.id) ?? {
      shop: "steam", objectId: game.id, title: game.title, libraryImageUrl: game.image, steamOnly: true,
    });
    const seen = new Set(merged.map(game => `${game.shop}:${game.objectId}`));
    for (const game of existing) {
      const key = `${game.shop}:${game.objectId}`;
      if (!seen.has(key)) { seen.add(key); merged.push(game); }
    }
    return merged;
  }, [activeShelf, results, steam]);
  const [genreArtwork, setGenreArtwork] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    const loadGenreArtwork = async () => {
      const responses = await Promise.all(
        gameGenres.slice(0, 8).map(async (genre) => {
          try {
            const response = await window.electron.hydraApi.post<{
              edges: CatalogueSearchResult[];
            }>("/catalogue/search", {
              data: {
                ...catalogueSearchSlice.getInitialState().filters,
                genres: [genre],
                ...newest,
                take: 30,
                skip: 0,
                downloadSourceIds: [],
              },
              needsAuth: false,
            });
            return (response.edges ?? []).filter(
              (game) => game.genres?.includes(genre) && game.libraryImageUrl
            );
          } catch {
            return [];
          }
        })
      );
      const used = new Set<string>();
      const images = new Set<string>();
      const artwork: Record<string, string> = {};
      gameGenres.slice(0, 8).forEach((genre, index) => {
        const candidates = responses[index];
        const ranked = [...candidates].sort((a, b) =>
          Number(b.genres?.[0] === genre) - Number(a.genres?.[0] === genre)
        );
        const game = ranked.find((candidate) =>
          !used.has(`${candidate.shop}:${candidate.objectId}`) &&
          !images.has(candidate.libraryImageUrl ?? "")
        );
        if (game?.libraryImageUrl) {
          used.add(`${game.shop}:${game.objectId}`);
          images.add(game.libraryImageUrl);
          artwork[genre] = game.libraryImageUrl;
        }
      });
      if (active) setGenreArtwork(artwork);
    };
    void loadGenreArtwork();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadGenreArtwork();
    }, 24 * 60 * 60 * 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [attempt]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setAttempt((value) => value + 1);
    }, 30 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);
  const alternatives = useMemo(
    () =>
      (results[CatalogueCategory.Hot] ?? []).flatMap((game): TrendingGame[] =>
        "libraryHeroImageUrl" in game && !("steamOnly" in game)
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
              {id === "upcoming" ? (pl ? "Nadchodzące gry" : "Upcoming games") : t(label)}
            </button>
          ))}
        </div>

        {(activeShelf === "new" || activeShelf === "upcoming") && steam && <small>{pl ? "Ostatnia synchronizacja Steam: " : "Steam last synced: "}{new Date(steam.checkedAt).toLocaleString(i18n.language)}</small>}
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
                      {"steamOnly" in game ? (
                        <Button theme="outline" size="small" onClick={() => void window.electron.openExternal("https://store.steampowered.com/app/" + game.objectId)}>Steam</Button>
                      ) : <CatalogueWishlistButton game={game} />}
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
                <Link to={buildGameDetailsPath(preview)}>
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
          artworkForGenre={(genre) => genreArtwork[genre]}
          onChooseGenre={(genre) => openResults({ genres: [genre] })}
          onChooseTag={(id) => openResults({ tags: [id] })}
        />
      </section>
    </section>
  );
}
