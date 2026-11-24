import { ChevronLeftIcon, ChevronRightIcon } from "@primer/octicons-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import Skeleton from "react-loading-skeleton";
import { ensureArray } from "@renderer/helpers";
import type { ShopDetailsWithAssets, TrendingGame } from "@types";
import { useAppSelector } from "@renderer/hooks";
import { selectFeatured } from "./featured-selection";
import "./hero.scss";

const rotationInterval = 15_000;
const motionPreference = "(prefers-reduced-motion: reduce)";
const featuredCache = new Map<string, TrendingGame[]>();
type PreviewDetails = Pick<ShopDetailsWithAssets, "screenshots" | "movies">;
const detailsCache = new Map<string, PreviewDetails>();

export function Hero({
  alternatives,
  onView,
}: Readonly<{ alternatives: TrendingGame[]; onView?: (game: TrendingGame) => void }>) {
  const { i18n, t } = useTranslation(["home", "catalogue"]);
  const language = i18n.language.split("-")[0];
  const [featured, setFeatured] = useState(
    () => featuredCache.get(language) ?? []
  );
  const [active, setActive] = useState(0);
  const [campaignIndex, setCampaignIndex] = useState(0);
  const [campaignHover, setCampaignHover] = useState(false);
  const [campaignFocus, setCampaignFocus] = useState(false);
  const [campaignPlay, setCampaignPlay] = useState(() => !window.matchMedia(motionPreference).matches);
  const [failedCampaignImages, setFailedCampaignImages] = useState<Set<string>>(() => new Set());
  const [preview, setPreview] = useState<string>();
  const [trailerKey, setTrailerKey] = useState<string | null>(null);
  const [play, setPlay] = useState(
    () => !window.matchMedia(motionPreference).matches
  );
  const [interacting, setInteracting] = useState(false);
  const [visible, setVisible] = useState(() => !document.hidden);
  const [details, setDetails] = useState<{
    key: string;
    value: PreviewDetails;
  }>();

  const campaignGames = Array.from(new Map(
    [...featured, ...alternatives].filter((game) => {
      const image = game.libraryHeroImageUrl ?? game.libraryImageUrl;
      return image && !failedCampaignImages.has(image);
    }).map((game) => [`${game.shop}:${game.objectId}`, game])
  ).values()).slice(0, 8);
  const campaignCount = campaignGames.length;
  const campaign = campaignGames[campaignIndex % Math.max(campaignCount, 1)];
  const moveCampaign = (direction: number) => {
    if (campaignCount > 1) setCampaignIndex((index) => (index % campaignCount + direction + campaignCount) % campaignCount);
  };
  useEffect(() => {
    if (campaignCount < 2 || !campaignPlay || campaignHover || campaignFocus || !visible) return;
    const timer = window.setTimeout(() => setCampaignIndex((index) => (index + 1) % campaignCount), rotationInterval);
    return () => window.clearTimeout(timer);
  }, [campaignIndex, campaignCount, campaignPlay, campaignHover, campaignFocus, visible]);
  useEffect(() => {
    const media = window.matchMedia(motionPreference);
    const change = (event: MediaQueryListEvent) => {
      if (event.matches) setCampaignPlay(false);
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const library = useAppSelector((state) => state.library.downloadLibrary);
  const ownedKeys = useMemo(() => new Set(library.filter(game => !game.isDeleted).flatMap(game => [
    `${game.shop}:${game.objectId}`,
    ...(game.catalogueGame ? [`${game.catalogueGame.shop}:${game.catalogueGame.objectId}`] : []),
  ])), [library]);
  const games = useMemo(() => selectFeatured(featured, alternatives, ownedKeys), [featured, alternatives, ownedKeys]);
  const [featuredError, setFeaturedError] = useState(false);
  const [featuredAttempt, setFeaturedAttempt] = useState(0);
  const selected = games[active % Math.max(games.length, 1)];
  const detailKey = selected
    ? `${selected.shop}:${selected.objectId}:${language}`
    : null;
  const shopDetails =
    detailKey &&
    (details?.key === detailKey ? details.value : detailsCache.get(detailKey));

  useEffect(() => {
    let current = true;
    setFeatured(featuredCache.get(language) ?? []);
    setFeaturedError(false);
    window.electron.hydraApi
      .get<TrendingGame[]>("/catalogue/featured", {
        params: { language },
        needsAuth: false,
      })
      .then((response) => {
        const games = ensureArray<TrendingGame>(
          response,
          "/catalogue/featured"
        );
        featuredCache.set(language, games.slice(0, 16));
        if (featuredCache.size > 3) { const oldest = featuredCache.keys().next().value; if (oldest !== undefined) featuredCache.delete(oldest); }
        if (current) setFeatured(games.slice(0, 16));
      })
      .catch(() => { if (current) setFeaturedError(true); });
    return () => {
      current = false;
    };
  }, [language, featuredAttempt]);

  const selectedShop = selected?.shop;
  const selectedId = selected?.objectId;
  useEffect(() => {
    if (
      !visible ||
      !detailKey ||
      !selectedShop ||
      !selectedId ||
      detailsCache.has(detailKey)
    )
      return;
    let current = true;
    window.electron
      .getGameShopDetails(selectedId, selectedShop, language)
      .then((value: ShopDetailsWithAssets | null) => {
        if (!value || !current) return;
        const compact = {screenshots: value.screenshots?.slice(0,4), movies: value.movies?.slice(0,4)};
        detailsCache.set(detailKey, compact);
        if (detailsCache.size > 4) { const oldest = detailsCache.keys().next().value; if (oldest !== undefined) detailsCache.delete(oldest); }
        if (current) setDetails({ key: detailKey, value: compact });
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [detailKey, language, selectedId, selectedShop, visible]);

  useEffect(() => {
    if (games.length < 2 || !play || interacting || !visible) return;
    const timer = window.setTimeout(() => {
      setPreview(undefined);
      setActive((index) => (index + 1) % games.length);
    }, rotationInterval);
    return () => window.clearTimeout(timer);
  }, [active, games.length, interacting, play, visible]);

  useEffect(() => {
    const onVisibility = () => { setVisible(!document.hidden); if (document.hidden) { setTrailerKey(null); setPreview(undefined); setDetails(undefined); detailsCache.clear(); } };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { document.removeEventListener("visibilitychange", onVisibility); detailsCache.clear(); };
  }, []);

  const move = (index: number) => {
    setActive((index + games.length) % games.length);
    setPreview(undefined);
  };
  const screens = shopDetails
    ? (shopDetails.screenshots?.slice(0, 4) ?? [])
    : [];
  const movie = shopDetails ? shopDetails.movies?.find(movie => movie.mp4?.["480"] || movie.webm?.["480"]) : undefined;
  const trailer = movie?.mp4?.["480"] ?? movie?.webm?.["480"];
  const safeTrailer = trailer && /^https:\/\//i.test(trailer) ? trailer : undefined;
  const playingTrailer = Boolean(visible && detailKey && trailerKey === detailKey && safeTrailer);
  useEffect(() => { if (playingTrailer) setPlay(false); }, [playingTrailer]);
  const cover = selected?.libraryHeroImageUrl ?? selected?.libraryImageUrl;
  const banner = campaign?.libraryHeroImageUrl ?? campaign?.libraryImageUrl;
  const pl = language === "pl";

  return (
    <>
      {campaign && banner && (
        <div className="catalogue-campaign-rotator"
          onPointerEnter={() => setCampaignHover(true)}
          onPointerLeave={() => setCampaignHover(false)}
          onFocus={() => setCampaignFocus(true)}
          onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setCampaignFocus(false); }}>
        <Link
          className="catalogue-campaign"
          to={campaign.uri}
          onClick={() => onView?.(campaign)}
          aria-label={campaign.title}
        >
          <img key={banner} src={banner} alt="" decoding="async" onError={() => setFailedCampaignImages((images) => new Set([...images, banner]))} />
          <span className="catalogue-campaign__name">
            {campaign.logoImageUrl ? (
              <img src={campaign.logoImageUrl} alt={campaign.title} />
            ) : (
              campaign.title
            )}
          </span>
        </Link>
        {campaignCount > 1 && <div className="catalogue-campaign-rotator__controls">
          <button type="button" aria-label={pl ? "Poprzednia gra" : "Previous game"} onClick={() => moveCampaign(-1)}><ChevronLeftIcon size={20} /></button>
          <span aria-live="off">{campaignIndex % campaignCount + 1} / {campaignCount}</span>
          <button type="button" aria-label={pl ? "Następna gra" : "Next game"} onClick={() => moveCampaign(1)}><ChevronRightIcon size={20} /></button>
          <button type="button" onClick={() => setCampaignPlay((value) => !value)}>{campaignPlay ? (pl ? "Wstrzymaj" : "Pause") : (pl ? "Wznów" : "Resume")}</button>
        </div>}
        </div>
      )}

      <section
        className="store-featured catalogue-store-width"
        onPointerEnter={() => setInteracting(true)}
        onPointerLeave={() => {
          setInteracting(false);
          setPreview(undefined);
        }}
        onFocus={() => setInteracting(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setInteracting(false);
        }}
      >
        <h1>{t("store_featured")}</h1>
        {selected ? (
          <div className="store-featured__frame">
            {playingTrailer ? <video key={detailKey} className="store-featured__image" src={safeTrailer} controls autoPlay preload="none" onEnded={() => setTrailerKey(null)} onError={() => setTrailerKey(null)} /> : <Link
              className="store-featured__image"
              to={selected.uri}
              onClick={() => onView?.(selected)}
              aria-label={selected.title}
            >
              {(preview ?? cover) && (
                <img src={preview ?? cover ?? undefined} alt="" decoding="async" />
              )}
            </Link>}
            <div className="store-featured__details" key={detailKey}>
              <Link to={selected.uri} onClick={() => onView?.(selected)} className="store-featured__title">
                {selected.title}
              </Link>
              {screens.length > 0 ? (
                <div className="store-featured__screens">
                  {screens.map((screen) => (
                    <button
                      type="button"
                      key={screen.path_full}
                      aria-label={
                        pl ? "Podgląd zrzutu ekranu" : "Preview screenshot"
                      }
                      onPointerEnter={() => setPreview(screen.path_full)}
                      onPointerLeave={() => setPreview(undefined)}
                      onFocus={() => setPreview(screen.path_full)}
                      onBlur={() => setPreview(undefined)}
                      onClick={() => setPreview(screen.path_full)}
                    >
                      <img src={screen.path_thumbnail} alt="" loading="lazy" decoding="async" />
                    </button>
                  ))}
                </div>
              ) : selected.description ? (
                <p className="store-featured__description">
                  {selected.description}
                </p>
              ) : null}
              {safeTrailer && <button type="button" className="store-featured__link" onClick={() => { setTrailerKey(playingTrailer ? null : detailKey); }}>{playingTrailer ? (pl ? "Zamknij zwiastun" : "Close trailer") : (pl ? "Odtwórz zwiastun" : "Play trailer")}</button>}
              <Link to={selected.uri} className="store-featured__link">
                {t("view_game")}
              </Link>
            </div>
            {games.length > 1 && (
              <>
                <button
                  className="store-featured__arrow store-featured__arrow--previous"
                  type="button"
                  aria-label={t("store_previous_featured", { ns: "catalogue" })}
                  onClick={() => move(active - 1)}
                >
                  <ChevronLeftIcon size={24} />
                </button>
                <button
                  className="store-featured__arrow store-featured__arrow--next"
                  type="button"
                  aria-label={t("store_next_featured", { ns: "catalogue" })}
                  onClick={() => move(active + 1)}
                >
                  <ChevronRightIcon size={24} />
                </button>
              </>
            )}
          </div>
        ) : (
          featuredError ? (
            <div className="store-featured__description" role="status">
              {pl ? "Nie udało się pobrać polecanych gier." : "Could not load featured games."}
              <button type="button" className="store-featured__link" onClick={() => setFeaturedAttempt(value => value + 1)}>{pl ? "Spróbuj ponownie" : "Retry"}</button>
            </div>
          ) : <Skeleton className="store-featured__loading" />
        )}
        {games.length > 1 && (
          <div className="store-featured__controls">
            {games.map((game, index) => (
              <button
                type="button"
                key={`${game.shop}:${game.objectId}`}
                aria-label={game.title}
                aria-current={index === active % games.length}
                onClick={() => move(index)}
              />
            ))}
            <button
              className="store-featured__play"
              type="button"
              onClick={() => setPlay(!play)}
            >
              {play ? (pl ? "Wstrzymaj" : "Pause") : pl ? "Wznów" : "Resume"}
            </button>
          </div>
        )}
      </section>
    </>
  );
}
