import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import type { TrendingGame } from "@types";
import { useTranslation } from "react-i18next";
import Skeleton from "react-loading-skeleton";
import { ensureArray } from "@renderer/helpers";
import "./hero.scss";

// Featured game per language, kept for the session so returning to Home
// paints the hero at once instead of a skeleton.
const featuredCache = new Map<string, TrendingGame[]>();

export function Hero() {
  const { i18n } = useTranslation();
  const [active, setActive] = useState(0);
  const polish = i18n.language.startsWith("pl");
  const language = i18n.language.split("-")[0];

  const [featuredGameDetails, setFeaturedGameDetails] = useState<
    TrendingGame[] | null
  >(() => featuredCache.get(language) ?? null);
  // Start in the loading state: rendering nothing first and the skeleton a
  // tick later pushed the whole page down.
  const [isLoading, setIsLoading] = useState(
    () => !featuredCache.has(language)
  );

  const navigate = useNavigate();

  useEffect(() => {
    if (!featuredCache.has(language)) setIsLoading(true);

    window.electron.hydraApi
      .get<TrendingGame[]>("/catalogue/featured", {
        params: { language },
        needsAuth: false,
      })
      .then((result) => {
        const featured = ensureArray<TrendingGame>(
          result,
          "/catalogue/featured"
        ).slice(0, 5);
        featuredCache.set(language, featured);
        setFeaturedGameDetails(featured);
      })
      .catch(() => {
        setFeaturedGameDetails([]);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [language]);

  if (isLoading) {
    return <Skeleton className="hero" />;
  }

  if (featuredGameDetails?.length) {
    const game = featuredGameDetails[active % featuredGameDetails.length];
    return (<section className="krysta-featured">
      <button
        type="button"
        onClick={() => navigate(game.uri)}
        className="hero"
        key={game.uri}
      >
        <div className="hero__backdrop">
          <img
            src={game.libraryHeroImageUrl ?? undefined}
            alt={game.description ?? ""}
            className="hero__media"
          />

          <div className="hero__content">
            <span className="krysta-featured__badge">{polish ? "Polecana gra" : "Featured game"}</span>
            <img
              src={game.logoImageUrl ?? undefined}
              width="250px"
              alt={game.description ?? ""}
              loading="eager"
              className="hero__logo"
            />
            <p className="hero__description">{game.description}</p>
            <span className="krysta-featured__cta">{polish ? "Szczegóły →" : "Details →"}</span>
          </div>
        </div>
      </button>
      {featuredGameDetails.length > 1 && <div className="krysta-featured__dots">{featuredGameDetails.map((item, index) => <button type="button" key={item.uri} aria-label={`Featured game ${index + 1}`} aria-current={index === active % featuredGameDetails.length} onClick={() => setActive(index)} />)}</div>}
      </section>);
  }

  return null;
}
