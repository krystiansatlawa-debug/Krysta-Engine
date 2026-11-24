import { ChevronLeftIcon, ChevronRightIcon } from "@primer/octicons-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import Skeleton from "react-loading-skeleton";
import { ensureArray } from "@renderer/helpers";
import type { ShopDetailsWithAssets, TrendingGame } from "@types";
import "./hero.scss";

const rotationInterval = 8_000;
const motionPreference = "(prefers-reduced-motion: reduce)";
const featuredCache = new Map<string, TrendingGame[]>();
const detailsCache = new Map<string, ShopDetailsWithAssets>();

export function Hero({
  alternatives,
}: Readonly<{ alternatives: TrendingGame[] }>) {
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
  const [play, setPlay] = useState(
    () => !window.matchMedia(motionPreference).matches
  );
  const [interacting, setInteracting] = useState(false);
  const [visible, setVisible] = useState(() => !document.hidden);
  const [details, setDetails] = useState<{
    key: string;
    value: ShopDetailsWithAssets;
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
  const games = Array.from(
    new Map(
      [...alternatives, ...featured].map((game) => [
        `${game.shop}:${game.objectId}`,
        game,
      ])
    ).values()
  )
    .sort(
      (first, second) =>
        Number(first.objectId === (featured[0] ?? alternatives[0])?.objectId) -
        Number(second.objectId === (featured[0] ?? alternatives[0])?.objectId)
    )
    .slice(0, 8);
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
        featuredCache.set(language, games);
        if (current) setFeatured(games);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [language]);

  const selectedShop = selected?.shop;
  const selectedId = selected?.objectId;
  useEffect(() => {
    if (
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
        if (!value) return;
        detailsCache.set(detailKey, value);
        if (current) setDetails({ key: detailKey, value });
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [detailKey, language, selectedId, selectedShop]);

  useEffect(() => {
    if (games.length < 2 || !play || interacting || !visible) return;
    const timer = window.setTimeout(() => {
      setPreview(undefined);
      setActive((index) => (index + 1) % games.length);
    }, rotationInterval);
    return () => window.clearTimeout(timer);
  }, [active, games.length, interacting, play, visible]);

  useEffect(() => {
    const onVisibility = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const move = (index: number) => {
    setActive((index + games.length) % games.length);
    setPreview(undefined);
  };
  const screens = shopDetails
    ? (shopDetails.screenshots?.slice(0, 4) ?? [])
    : [];
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
          aria-label={campaign.title}
        >
          <img key={banner} src={banner} alt="" onError={() => setFailedCampaignImages((images) => new Set([...images, banner]))} />
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
            <Link
              className="store-featured__image"
              to={selected.uri}
              aria-label={selected.title}
            >
              {(preview ?? cover) && (
                <img src={preview ?? cover ?? undefined} alt="" />
              )}
            </Link>
            <div className="store-featured__details" key={detailKey}>
              <Link to={selected.uri} className="store-featured__title">
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
                      <img src={screen.path_thumbnail} alt="" />
                    </button>
                  ))}
                </div>
              ) : selected.description ? (
                <p className="store-featured__description">
                  {selected.description}
                </p>
              ) : null}
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
          <Skeleton className="store-featured__loading" />
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
