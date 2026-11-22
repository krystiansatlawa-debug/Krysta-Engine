import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { levelDBService } from "@renderer/services/leveldb.service";
import { orderBy } from "lodash-es";
import { useNavigate } from "react-router-dom";

import Skeleton, { SkeletonTheme } from "react-loading-skeleton";

import { Button, GameCard, Hero } from "@renderer/components";
import type {
  CatalogueSearchResult,
  DownloadSource,
  ShopAssets,
  Steam250Game,
} from "@types";

import flameIconStatic from "@renderer/assets/icons/flame-static.png";
import flameIconAnimated from "@renderer/assets/icons/flame-animated.gif";
import starsIconAnimated from "@renderer/assets/icons/stars-animated.gif";

import { buildGameDetailsPath, ensureArray } from "@renderer/helpers";
import { catalogueSearchSlice } from "@renderer/features/catalogue-search";
import { CatalogueCategory } from "@shared";
import {
  gameGenres,
  gameTags,
  type BrowseSelection,
} from "./browse-categories";
import "./home.scss";

type HomeSelection =
  | { kind: "featured"; category: CatalogueCategory }
  | BrowseSelection;
type HomeResults = {
  selection: HomeSelection;
  attempt: number;
  games: (ShopAssets | CatalogueSearchResult)[] | null;
};

const categories = Object.values(CatalogueCategory);
const pageSize = 12;

export default function Home() {
  const { t } = useTranslation("home");
  const navigate = useNavigate();

  const [animateFlame, setAnimateFlame] = useState(false);
  const [randomGame, setRandomGame] = useState<Steam250Game | null>(null);
  const [selection, setSelection] = useState<HomeSelection>({
    kind: "featured",
    category: CatalogueCategory.Hot,
  });
  const [attempt, setAttempt] = useState(0);
  const [results, setResults] = useState<HomeResults | null>(null);
  const currentCatalogueCategory =
    selection.kind === "featured" ? selection.category : null;
  const currentResults =
    results?.selection === selection && results.attempt === attempt
      ? results
      : null;

  useEffect(() => {
    let cancelled = false;
    const loadGames = async () => {
      try {
        const sources = (await levelDBService.values(
          "downloadSources"
        )) as DownloadSource[];
        if (cancelled) return;
        const downloadSources = orderBy(sources, "createdAt", "desc");
        const pagination = {
          take: pageSize,
          skip: 0,
          downloadSourceIds: downloadSources.map((source) => source.id),
        };

        let games: HomeResults["games"];
        if (selection.kind === "featured") {
          const path = `/catalogue/${selection.category}`;
          const response = await window.electron.hydraApi.get<ShopAssets[]>(
            path,
            {
              params: pagination,
              needsAuth: false,
            }
          );
          games = ensureArray<ShopAssets>(response, path);
        } else {
          const path = "/catalogue/search";
          const response = await window.electron.hydraApi.post<{
            edges: CatalogueSearchResult[];
          }>(path, {
            data: {
              ...catalogueSearchSlice.getInitialState().filters,
              ...pagination,
              genres: selection.kind === "genre" ? [selection.name] : [],
              tags: selection.kind === "tag" ? [selection.id] : [],
            },
            needsAuth: false,
          });
          games = ensureArray<CatalogueSearchResult>(response?.edges, path);
        }

        if (!cancelled) setResults({ selection, attempt, games });
      } catch {
        if (!cancelled) setResults({ selection, attempt, games: null });
      }
    };

    void loadGames();
    return () => {
      cancelled = true;
    };
  }, [selection, attempt]);

  const getRandomGame = useCallback(() => {
    window.electron.getRandomGame().then((game) => {
      if (game) setRandomGame(game);
    });
  }, []);

  const handleRandomizerClick = () => {
    if (randomGame) {
      navigate(
        buildGameDetailsPath(
          { ...randomGame, shop: "steam" },
          {
            fromRandomizer: "1",
          }
        )
      );
    }
  };

  const handleCategoryClick = (category: CatalogueCategory) => {
    if (category !== currentCatalogueCategory) {
      setSelection({ kind: "featured", category });
    }
  };

  useEffect(() => {
    getRandomGame();
  }, [getRandomGame]);

  const browseLabel = (name: string) =>
    t(`browse_labels.${name}`, { defaultValue: name });
  const renderGenre = (name: (typeof gameGenres)[number]) => {
    const selected = selection.kind === "genre" && selection.name === name;
    return (
      <Button
        key={name}
        size="small"
        theme={selected ? "primary" : "outline"}
        aria-pressed={selected}
        onClick={() => {
          if (!selected) setSelection({ kind: "genre", name });
        }}
      >
        {browseLabel(name)}
      </Button>
    );
  };

  const handleMouseEnterCategory = (category: CatalogueCategory) => {
    if (category === CatalogueCategory.Hot) {
      setAnimateFlame(true);
    }
  };

  const handleMouseLeaveCategory = (category: CatalogueCategory) => {
    if (category === CatalogueCategory.Hot) {
      setAnimateFlame(false);
    }
  };

  return (
    <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
      <section className="home__content">
        <Hero />

        <section className="home__header">
          <ul className="home__buttons-list">
            {categories.map((category) => (
              <li key={category}>
                <Button
                  theme={
                    category === currentCatalogueCategory
                      ? "primary"
                      : "outline"
                  }
                  onClick={() => handleCategoryClick(category)}
                  aria-pressed={category === currentCatalogueCategory}
                  onMouseEnter={() => handleMouseEnterCategory(category)}
                  onMouseLeave={() => handleMouseLeaveCategory(category)}
                >
                  {category === CatalogueCategory.Hot && (
                    <div className="home__icon-wrapper">
                      <img
                        src={flameIconStatic}
                        alt=""
                        className="home__flame-icon"
                        style={{ display: animateFlame ? "none" : "block" }}
                      />
                      <img
                        src={flameIconAnimated}
                        alt=""
                        className="home__flame-icon"
                        style={{ display: animateFlame ? "block" : "none" }}
                      />
                    </div>
                  )}

                  {t(category)}
                </Button>
              </li>
            ))}
          </ul>

          <Button
            onClick={handleRandomizerClick}
            theme="outline"
            disabled={!randomGame}
          >
            <div className="home__icon-wrapper">
              <img
                src={starsIconAnimated}
                alt=""
                className="home__stars-icon"
              />
            </div>
            {t("surprise_me")}
          </Button>
        </section>

        <section className="home__browse" aria-labelledby="home-browse-title">
          <h2 id="home-browse-title">{t("browse_games")}</h2>
          <div
            className="home__browse-buttons"
            aria-label={t("browse_genres")}
            role="group"
          >
            {gameGenres.slice(0, 8).map(renderGenre)}
          </div>
          <details className="home__browse-details">
            <summary>{t("browse_more")}</summary>
            <h3>{t("browse_genres")}</h3>
            <div className="home__browse-buttons">
              {gameGenres.slice(8).map(renderGenre)}
            </div>
            <h3>{t("browse_tags")}</h3>
            <div className="home__browse-buttons">
              {gameTags.map(([id, name]) => {
                const selected =
                  selection.kind === "tag" && selection.id === id;
                return (
                  <Button
                    key={id}
                    size="small"
                    theme={selected ? "primary" : "outline"}
                    aria-pressed={selected}
                    onClick={() => {
                      if (!selected) setSelection({ kind: "tag", id, name });
                    }}
                  >
                    {browseLabel(name)}
                  </Button>
                );
              })}
            </div>
          </details>
        </section>

        <h2 className="home__title">
          {currentCatalogueCategory === CatalogueCategory.Hot && (
            <div className="home__title-icon">
              <img
                src={flameIconAnimated}
                alt=""
                className="home__title-flame-icon"
              />
            </div>
          )}

          {selection.kind === "featured"
            ? t(selection.category)
            : browseLabel(selection.name)}
        </h2>

        <section className="home__cards" aria-busy={!currentResults}>
          {!currentResults &&
            Array.from({ length: pageSize }).map((_, index) => (
              <Skeleton key={index} className="home__card-skeleton" />
            ))}
          {currentResults?.games === null && (
            <div className="home__no-results" role="status">
              <p>{t("browse_load_error")}</p>
              <Button theme="outline" onClick={() => setAttempt(attempt + 1)}>
                {t("browse_retry")}
              </Button>
            </div>
          )}
          {currentResults?.games?.length === 0 && (
            <p className="home__no-results" role="status">
              {t("no_results")}
            </p>
          )}
          {currentResults?.games?.map((result) => (
            <GameCard
              key={`${result.shop}:${result.objectId}`}
              game={result}
              onClick={() => navigate(buildGameDetailsPath(result))}
            />
          ))}
        </section>
      </section>
    </SkeletonTheme>
  );
}
