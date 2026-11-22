import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import type { TrendingGame } from "@types";
import { useTranslation } from "react-i18next";
import { ChevronLeftIcon, ChevronRightIcon } from "@primer/octicons-react";
import Skeleton from "react-loading-skeleton";
import { ensureArray } from "@renderer/helpers";
import "./hero.scss";

const rotationInterval = 8_000;
const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

// Keep successful results per language so returning to Home can render immediately.
const featuredCache = new Map<string, TrendingGame[]>();

export function Hero() {
  const { i18n, t } = useTranslation("catalogue");
  const [active, setActive] = useState(0);
  const polish = i18n.language.startsWith("pl");
  const language = i18n.language.split("-")[0];

  const [loadResult, setLoadResult] = useState<{
    language: string;
    games: TrendingGame[];
  } | null>(null);
  const [playbackOverride, setPlaybackOverride] = useState<boolean | null>(
    null
  );
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia(reducedMotionQuery).matches
  );
  const [windowHidden, setWindowHidden] = useState(() => document.hidden);
  const [hovering, setHovering] = useState(false);
  const [slideFocused, setSlideFocused] = useState(false);

  const featuredGames =
    loadResult?.language === language
      ? loadResult.games
      : featuredCache.get(language);
  const slideCount = featuredGames?.length ?? 0;
  const playing = playbackOverride ?? !reducedMotion;

  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    window.electron.hydraApi
      .get<TrendingGame[]>("/catalogue/featured", {
        params: { language },
        needsAuth: false,
      })
      .then((result) => {
        const featured = ensureArray<TrendingGame>(
          result,
          "/catalogue/featured"
        );
        const games = Array.from(
          new Map(featured.map((game) => [game.uri, game])).values()
        );
        if (cancelled) return;
        featuredCache.set(language, games);
        setLoadResult({ language, games });
      })
      .catch(() => {
        if (!cancelled && !featuredCache.has(language)) {
          setLoadResult({ language, games: [] });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [language]);

  useEffect(() => {
    const motionPreference = window.matchMedia(reducedMotionQuery);
    const updateMotionPreference = () =>
      setReducedMotion(motionPreference.matches);
    const updateVisibility = () => setWindowHidden(document.hidden);

    motionPreference.addEventListener("change", updateMotionPreference);
    document.addEventListener("visibilitychange", updateVisibility);

    return () => {
      motionPreference.removeEventListener("change", updateMotionPreference);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  useEffect(() => {
    if (
      slideCount < 2 ||
      !playing ||
      windowHidden ||
      hovering ||
      slideFocused
    ) {
      return;
    }

    const timer = window.setTimeout(
      () => setActive((index) => (index + 1) % slideCount),
      rotationInterval
    );
    return () => window.clearTimeout(timer);
  }, [
    active,
    featuredGames,
    hovering,
    playing,
    slideCount,
    slideFocused,
    windowHidden,
  ]);

  if (!featuredGames) {
    return <Skeleton className="hero" />;
  }

  if (slideCount) {
    const currentIndex = active % slideCount;
    const game = featuredGames[currentIndex];
    return (
      <section
        className="krysta-featured"
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") setHovering(true);
        }}
        onPointerLeave={() => setHovering(false)}
        onFocus={(event) =>
          setSlideFocused(
            event.target.matches(":focus-visible") &&
              !event.target.closest(".krysta-featured__playback")
          )
        }
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setSlideFocused(false);
          }
        }}
      >
        <button
          type="button"
          onClick={() => navigate(game.uri)}
          className="hero"
        >
          <div className="hero__backdrop" key={game.uri}>
            <img
              src={game.libraryHeroImageUrl ?? undefined}
              alt=""
              className="hero__media"
            />

            <div className="hero__content">
              <span className="krysta-featured__badge">
                {polish ? "Polecana gra" : "Featured game"}
              </span>
              {game.logoImageUrl ? (
                <img
                  src={game.logoImageUrl}
                  width={250}
                  alt={game.title}
                  loading="eager"
                  className="hero__logo"
                />
              ) : (
                <strong className="hero__title">{game.title}</strong>
              )}
              <p className="hero__description">{game.description}</p>
              <span className="krysta-featured__cta">
                {polish ? "Szczegóły →" : "Details →"}
              </span>
            </div>
          </div>
        </button>
        {slideCount > 1 && (
          <div className="krysta-featured__controls">
            <button
              type="button"
              className="krysta-featured__playback"
              aria-label={t("store_previous_featured")}
              onClick={() =>
                setActive((currentIndex + slideCount - 1) % slideCount)
              }
            >
              <ChevronLeftIcon />
            </button>
            <div className="krysta-featured__dots">
              {featuredGames.map((item, index) => (
                <button
                  type="button"
                  key={item.uri}
                  aria-label={
                    polish
                      ? `Polecana gra ${index + 1} z ${slideCount}`
                      : `Featured game ${index + 1} of ${slideCount}`
                  }
                  aria-current={index === currentIndex}
                  onClick={() => setActive(index)}
                />
              ))}
            </div>
            <button
              type="button"
              className="krysta-featured__playback"
              aria-label={t("store_next_featured")}
              onClick={() => setActive((currentIndex + 1) % slideCount)}
            >
              <ChevronRightIcon />
            </button>
            <button
              type="button"
              className="krysta-featured__playback"
              onClick={() => setPlaybackOverride(!playing)}
            >
              {playing
                ? polish
                  ? "Wstrzymaj rotację"
                  : "Pause rotation"
                : polish
                  ? "Wznów rotację"
                  : "Resume rotation"}
            </button>
          </div>
        )}
      </section>
    );
  }

  return null;
}
