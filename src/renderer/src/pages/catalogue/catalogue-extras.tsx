import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ImageIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components";
import { buildGameDetailsPath } from "@renderer/helpers";
import { CatalogueWishlistButton } from "./catalogue-wishlist";
import type { WishlistGame } from "./catalogue-wishlist";
import "./catalogue-extras.scss";

export function useCatalogueRequest<T>(
  load: (signal: AbortSignal) => Promise<T>
) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    load: (signal: AbortSignal) => Promise<T>;
    attempt: number;
    data: T | null;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void load(signal)
      .then((data) => {
        if (!signal.aborted) setResult({ load, attempt, data });
      })
      .catch(() => {
        if (!signal.aborted) setResult({ load, attempt, data: null });
      });

    return () => {
      controller.abort();
    };
  }, [load, attempt]);

  return {
    data:
      result?.load === load && result.attempt === attempt
        ? result.data
        : undefined,
    retry: () => setAttempt((current) => current + 1),
  };
}

export function CatalogueRequestStatus({
  loading,
  retry,
}: Readonly<{ loading: boolean; retry: () => void }>) {
  const { t } = useTranslation("home");

  return (
    <div className="catalogue-extra__status">
      <p role="status">
        {t(loading ? "catalogue_extra_loading" : "browse_load_error")}
      </p>
      {!loading && (
        <Button theme="outline" onClick={retry}>
          {t("browse_retry")}
        </Button>
      )}
    </div>
  );
}

export function CatalogueGameRow({
  game,
  prefix,
}: Readonly<{ game: WishlistGame; prefix?: ReactNode }>) {
  return (
    <li className="catalogue-extra__row">
      {prefix}
      <Link className="catalogue-extra__game" to={buildGameDetailsPath(game)}>
        <span className="catalogue-extra__art">
          {game.libraryImageUrl ? (
            <img src={game.libraryImageUrl} alt="" loading="lazy" />
          ) : (
            <ImageIcon size={22} aria-hidden="true" />
          )}
        </span>
        <span className="catalogue-extra__game-copy">
          <strong>{game.title}</strong>
        </span>
      </Link>
      <CatalogueWishlistButton game={game} />
    </li>
  );
}
