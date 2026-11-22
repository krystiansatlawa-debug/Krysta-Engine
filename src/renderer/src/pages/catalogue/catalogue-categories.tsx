import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { clearFilters, setFilters, setMode } from "@renderer/features";
import { useAppDispatch } from "@renderer/hooks";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components";
import { getLocalizedSteamMetadata } from "@renderer/hooks/use-catalogue";
import {
  getCatalogueSteamTags,
  getSteamTagLabel,
  removeDiacritics,
} from "@shared";
import { gameGenres, gameTagGroups } from "./browse-categories";

const tagPageSize = 24;
const normalize = (text: string) =>
  removeDiacritics(text).toLocaleLowerCase().trim();

export function SteamTagDirectory({
  onChooseTag,
}: Readonly<{ onChooseTag: (id: number) => void }>) {
  const { t, i18n } = useTranslation("home");
  const [request, setRequest] = useState(0);
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(tagPageSize);
  const [result, setResult] = useState<{
    locale: string;
    request: number;
    metadata: Record<string, Record<string, number>> | null;
  } | null>(null);
  const locale = i18n.language;

  useEffect(() => {
    let active = true;
    void getLocalizedSteamMetadata<Record<string, number>>(
      "/catalogue/steam/tags",
      locale
    )
      .then((metadata) => {
        const valid = Object.values(metadata.en ?? {}).some(Number.isInteger);
        if (active)
          setResult({ locale, request, metadata: valid ? metadata : null });
      })
      .catch(() => {
        if (active) setResult({ locale, request, metadata: null });
      });
    return () => {
      active = false;
    };
  }, [locale, request]);

  const currentResult =
    result?.locale === locale && result.request === request ? result : null;
  const tags = useMemo(
    () => getCatalogueSteamTags(currentResult?.metadata ?? {}, locale),
    [currentResult, locale]
  );

  if (!currentResult) return <p role="status">{t("browse_tags_loading")}</p>;

  if (!currentResult.metadata) {
    return (
      <div className="catalogue-discover__tags">
        <p role="status">{t("browse_tags_error")}</p>
        <Button
          size="small"
          theme="outline"
          onClick={() => setRequest(request + 1)}
        >
          {t("browse_retry")}
        </Button>
      </div>
    );
  }

  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const matches = tags.filter(({ english, label }) => {
    const text = normalize(`${label} ${english}`);
    return terms.every((term) => text.includes(term));
  });

  return (
    <div className="catalogue-discover__tag-directory">
      <label>
        {t("browse_tag_search")}
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setVisibleCount(tagPageSize);
          }}
        />
      </label>
      {matches.length === 0 && (
        <p role="status">{t("browse_tags_no_results")}</p>
      )}
      <div className="catalogue-discover__tags">
        {matches.slice(0, visibleCount).map(({ id, label }) => (
          <Button
            key={id}
            size="small"
            theme="outline"
            onClick={() => onChooseTag(id)}
          >
            {label}
          </Button>
        ))}
      </div>
      {visibleCount < matches.length && (
        <Button
          size="small"
          theme="outline"
          onClick={() => setVisibleCount(visibleCount + tagPageSize)}
        >
          {t("browse_more_tags", { count: matches.length - visibleCount })}
        </Button>
      )}
    </div>
  );
}

export function CatalogueCategories({
  artworkForGenre,
  onChooseGenre,
  onChooseTag,
}: Readonly<{
  artworkForGenre: (genre: string) => string | null | undefined;
  onChooseGenre: (genre: string) => void;
  onChooseTag: (id: number) => void;
}>) {
  const { t, i18n } = useTranslation("home");
  const label = (name: string) =>
    t(`browse_labels.${name}`, { defaultValue: name });

  const renderGenre = (name: (typeof gameGenres)[number]) => (
    <Button
      key={name}
      size="small"
      theme="outline"
      onClick={() => onChooseGenre(name)}
    >
      {label(name)}
    </Button>
  );

  return (
    <>
      <div className="catalogue-discover__genre-cards">
        {gameGenres.slice(0, 8).map((genre) => {
          const artwork = artworkForGenre(genre);
          return (
            <button
              type="button"
              key={genre}
              onClick={() => onChooseGenre(genre)}
            >
              {artwork && <img src={artwork} alt="" loading="lazy" />}
              <span>{label(genre)}</span>
            </button>
          );
        })}
      </div>
      <details className="catalogue-discover__more">
        <summary>{t("browse_more")}</summary>
        <Link
          className="catalogue-discover__all-tags-link"
          to="/catalogue/tags"
        >
          {t("store_show_all_tags")}
        </Link>
        <h3>{t("browse_genres")}</h3>
        <div className="catalogue-discover__tags">
          {gameGenres.slice(8).map(renderGenre)}
        </div>
        {gameTagGroups.map((group) => (
          <section key={group.label}>
            <h3>{t(group.label)}</h3>
            <div className="catalogue-discover__tags">
              {group.tags.map(([id, name]) => (
                <Button
                  key={id}
                  size="small"
                  theme="outline"
                  onClick={() => onChooseTag(id)}
                >
                  {getSteamTagLabel(id, i18n.language, label(name))}
                </Button>
              ))}
            </div>
          </section>
        ))}
      </details>
    </>
  );
}

export function CatalogueTagsPage() {
  const { t } = useTranslation("home");
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  return (
    <section className="catalogue-discover">
      <section className="catalogue-discover__tags-page catalogue-store-width">
        <h1>{t("browse_all_steam_tags")}</h1>
        <SteamTagDirectory
          onChooseTag={(id) => {
            dispatch(setMode("modern"));
            dispatch(clearFilters());
            dispatch(setFilters({ tags: [id] }));
            navigate("/catalogue/search");
          }}
        />
      </section>
    </section>
  );
}
