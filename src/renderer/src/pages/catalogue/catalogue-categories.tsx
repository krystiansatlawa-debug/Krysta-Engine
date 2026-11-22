import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components";
import { getLocalizedSteamMetadata } from "@renderer/hooks/use-catalogue";
import { removeDiacritics } from "@shared";
import { gameGenres, gameTagGroups } from "./browse-categories";

const tagPageSize = 24;
const normalize = (text: string) =>
  removeDiacritics(text).toLocaleLowerCase().trim();

type Tag = { id: number; english: string; label: string };

function SteamTagDirectory({
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
  const tags = useMemo(() => {
    const metadata = currentResult?.metadata;
    if (!metadata) return [];

    const language = locale.split("-")[0];
    const localized = new Map(
      Object.entries(metadata[language] ?? {}).map(([label, id]) => [id, label])
    );
    const unique = new Map<number, Tag>();
    for (const [name, id] of Object.entries(metadata.en)) {
      if (!Number.isInteger(id) || id <= 0 || unique.has(id)) continue;
      const english = name.trim();
      unique.set(id, {
        id,
        english,
        label: t(`browse_labels.${english}`, {
          defaultValue: localized.get(id)?.trim() || english,
        }),
      });
    }
    return Array.from(unique.values()).sort((a, b) =>
      a.label.localeCompare(b.label, locale)
    );
  }, [currentResult, locale, t]);

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
  onChooseGenre,
  onChooseTag,
}: Readonly<{
  onChooseGenre: (genre: string) => void;
  onChooseTag: (id: number) => void;
}>) {
  const { t } = useTranslation("home");
  const [directoryOpened, setDirectoryOpened] = useState(false);
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
      <div className="catalogue-discover__tags">
        {gameGenres.slice(0, 8).map(renderGenre)}
      </div>
      <details className="catalogue-discover__more">
        <summary>{t("browse_more")}</summary>
        <details
          className="catalogue-discover__all-tags"
          onToggle={(event) => {
            if (event.currentTarget.open) setDirectoryOpened(true);
          }}
        >
          <summary>{t("browse_all_steam_tags")}</summary>
          {directoryOpened && <SteamTagDirectory onChooseTag={onChooseTag} />}
        </details>
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
                  {label(name)}
                </Button>
              ))}
            </div>
          </section>
        ))}
      </details>
    </>
  );
}
