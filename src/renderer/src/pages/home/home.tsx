import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { ArrowDownIcon, BookIcon, PlayIcon } from "@primer/octicons-react";
import Skeleton from "react-loading-skeleton";

import { Button } from "@renderer/components";
import { VerticalCoverCard } from "@renderer/components/vertical-cover-card/vertical-cover-card";
import {
  selectGroupedLibrary,
  selectIsLibraryLoading,
  setHeaderTitle,
} from "@renderer/features";
import { buildGameDetailsPath, resolveImageSource } from "@renderer/helpers";
import {
  useAppDispatch,
  useAppSelector,
  useGameCollections,
} from "@renderer/hooks";
import { getVerticalCoverCardImageSources } from "@renderer/components/vertical-cover-card/vertical-cover-card-image-sources";
import type { LibraryGame } from "@types";

import {
  findKrystaPendingPatch,
  useKrystaPendingPatches,
} from "../library/krysta-patch-badge";
import { FAVORITES_COLLECTION_ID } from "../library/library-category";
import "./home.scss";

const shelfSize = 6;
const timestamp = (value: Date | string | null | undefined) =>
  value ? new Date(value).getTime() || 0 : 0;

function LibraryArtwork({ sources }: Readonly<{ sources: string[] }>) {
  const [index, setIndex] = useState(0);
  const source = sources[index];

  return source ? (
    <img
      className="library-home__featured-art"
      src={source}
      alt=""
      onError={() => setIndex((current) => current + 1)}
    />
  ) : null;
}

function LibraryShelf({
  title,
  games,
}: Readonly<{ title: string; games: LibraryGame[] }>) {
  const navigate = useNavigate();
  if (!games.length) return null;

  return (
    <section className="library-home__section">
      <h2>{title}</h2>
      <ul className="library-home__shelf">
        {games.map((game) => (
          <li key={game.id}>
            <VerticalCoverCard
              gameTitle={game.title}
              coverImageUrls={[
                game.customCoverImageUrl,
                game.coverImageUrl,
                game.libraryImageUrl,
                game.iconUrl,
              ].map(resolveImageSource)}
              catalogueImages={game.images}
              useClassicsLayout={game.shop === "launchbox"}
              onClick={() => navigate(buildGameDetailsPath(game))}
            />
            <span>{game.title}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Home() {
  const { t } = useTranslation(["home", "sidebar", "game_details"]);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const games = useAppSelector(selectGroupedLibrary);
  const isLoading = useAppSelector(selectIsLibraryLoading);
  const runningGameId = useAppSelector(
    (state) => state.gameRunning.gameRunning?.id
  );
  const userId = useAppSelector((state) => state.userDetails.userDetails?.id);
  const { collections, loadCollections } = useGameCollections();
  const patches = useKrystaPendingPatches();

  useEffect(() => {
    dispatch(setHeaderTitle(t("home", { ns: "sidebar" })));
  }, [dispatch, t]);

  useEffect(() => {
    if (userId) void loadCollections();
  }, [userId, loadCollections]);

  const recent = useMemo(
    () =>
      games
        .filter((game) => timestamp(game.lastTimePlayed) > 0)
        .sort(
          (a, b) => timestamp(b.lastTimePlayed) - timestamp(a.lastTimePlayed)
        ),
    [games]
  );
  const added = useMemo(
    () =>
      [...games].sort(
        (a, b) => timestamp(b.addedToLibraryAt) - timestamp(a.addedToLibraryAt)
      ),
    [games]
  );
  const favorites = useMemo(
    () => games.filter((game) => game.favorite),
    [games]
  );
  const updates = useMemo(
    () =>
      games
        .flatMap((game) => {
          const patch = findKrystaPendingPatch(game, patches);
          return patch ? [{ game, patch }] : [];
        })
        .slice(0, shelfSize),
    [games, patches]
  );

  const featured = recent[0] ?? added[0];
  const featuredArtwork = featured
    ? getVerticalCoverCardImageSources([
        featured.customHeroImageUrl,
        featured.libraryHeroImageUrl,
        featured.libraryImageUrl,
        featured.coverImageUrl,
      ]).map(resolveImageSource)
    : [];
  const canPlayFeatured =
    featured &&
    featured.id !== runningGameId &&
    (Boolean(featured.executablePath) ||
      (featured.shop === "launchbox" && (featured.discs?.length ?? 0) > 0));

  return (
    <section className="library-home">
      <header className="library-home__header">
        <h1>{t("library_home")}</h1>
        <Link className="library-home__link" to="/library">
          <BookIcon /> {t("open_library")}
        </Link>
      </header>

      {featured && (
        <section className="library-home__featured">
          <LibraryArtwork
            key={featuredArtwork.join("\u0000")}
            sources={featuredArtwork}
          />
          <div className="library-home__featured-copy">
            <p>{t(recent.length ? "continue_playing" : "last_added")}</p>
            <h2>{featured.title}</h2>
            <div className="library-home__featured-actions">
              {canPlayFeatured && (
                <Button
                  onClick={() =>
                    navigate(buildGameDetailsPath(featured), {
                      state: { quickPlayGameId: featured.id },
                    })
                  }
                >
                  <PlayIcon /> {t("play", { ns: "game_details" })}
                </Button>
              )}
              <Button
                theme="outline"
                onClick={() => navigate(buildGameDetailsPath(featured))}
              >
                {t("view_game")}
              </Button>
            </div>
          </div>
        </section>
      )}

      {!featured &&
        (isLoading ? (
          <Skeleton className="library-home__placeholder" height={270} />
        ) : (
          <section className="library-home__empty">
            <BookIcon size={28} />
            <h2>{t("library_home_empty")}</h2>
            <Link className="library-home__link" to="/catalogue">
              {t("browse_games")}
            </Link>
          </section>
        ))}

      <LibraryShelf
        title={t("recently_played")}
        games={recent.slice(0, shelfSize)}
      />
      {updates.length > 0 && (
        <section className="library-home__section">
          <h2>{t("library_updates")}</h2>
          <ul className="library-home__updates">
            {updates.map(({ game, patch }) => (
              <li key={game.id}>
                <Link to={buildGameDetailsPath(game, { tab: "updates" })}>
                  <ArrowDownIcon size={18} />
                  <span>
                    <strong>{game.title}</strong>
                    <span>{patch.title}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <LibraryShelf
        title={t("recently_added")}
        games={added.slice(0, shelfSize)}
      />

      {(favorites.length > 0 || collections.length > 0) && (
        <section className="library-home__section">
          <h2>{t("library_collections")}</h2>
          <ul className="library-home__collections">
            {favorites.length > 0 && (
              <li>
                <Link to={`/library?collection=${FAVORITES_COLLECTION_ID}`}>
                  {t("library_favorites")}
                </Link>
              </li>
            )}
            {collections.map(({ id, name }) => (
              <li key={id}>
                <Link to={`/library?collection=${encodeURIComponent(id)}`}>
                  {name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
