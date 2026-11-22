import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ArrowRightIcon } from "@primer/octicons-react";
import Skeleton from "react-loading-skeleton";

import { Button, GameCard, Hero } from "@renderer/components";
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
} from "@types";

import { CatalogueCategories } from "./catalogue-categories";

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

const shelfSize = 6;

export default function CatalogueDiscover() {
  const { t } = useTranslation("home");
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const mode = useAppSelector((state) => state.catalogueSearch.mode);
  const [results, setResults] = useState<ShelfResults>({});
  const [attempt, setAttempt] = useState(0);
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

  const hasError = Object.values(results).some((games) => games === null);

  return (
    <section className="catalogue-discover">
      <Hero />

      <section className="catalogue-discover__browse">
        <header className="catalogue-discover__heading">
          <h1>{t("browse_games")}</h1>
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
          onChooseGenre={(genre) => openResults({ genres: [genre] })}
          onChooseTag={(id) => openResults({ tags: [id] })}
        />
      </section>

      {hasError && (
        <div className="catalogue-discover__status" role="status">
          <p>{t("browse_load_error")}</p>
          <Button
            theme="outline"
            size="small"
            onClick={() => {
              setResults({});
              setAttempt((current) => current + 1);
            }}
          >
            {t("browse_retry")}
          </Button>
        </div>
      )}

      {shelves.map(({ id, label }) => {
        const games = results[id];
        if (games !== undefined && !games?.length) return null;

        return (
          <section
            className="catalogue-discover__shelf"
            key={id}
            aria-busy={games === undefined}
          >
            <header className="catalogue-discover__heading">
              <h2>{t(label)}</h2>
              {id === "new" && (
                <Button
                  theme="outline"
                  size="small"
                  onClick={() => openResults(newest)}
                >
                  {t("browse_all_new")} <ArrowRightIcon />
                </Button>
              )}
            </header>
            <div className="catalogue-discover__games">
              {games
                ? games.map((game) => (
                    <GameCard
                      key={`${game.shop}:${game.objectId}`}
                      game={game}
                      onClick={() => navigate(buildGameDetailsPath(game))}
                    />
                  ))
                : Array.from({ length: shelfSize }, (_, index) => (
                    <Skeleton
                      key={index}
                      className="catalogue-discover__placeholder"
                    />
                  ))}
            </div>
          </section>
        );
      })}
    </section>
  );
}
