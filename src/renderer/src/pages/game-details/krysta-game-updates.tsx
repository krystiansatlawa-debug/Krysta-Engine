import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ToolsIcon } from "@primer/octicons-react";
import "./krysta-game-updates.scss";
import { KrystaGameWatch } from "./krysta-game-watch";

type News = Awaited<
  ReturnType<typeof window.electron.getKrystaGameNews>
>["items"][number];
function safeImage(value: string) {
  try {
    const expanded = value
      .trim()
      .replace(
        /\{STEAM_CLAN_IMAGE\}/gi,
        "https://clan.fastly.steamstatic.com/images"
      )
      .replace(
        /\{STEAM_APP_IMAGE\}/gi,
        "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps"
      )
      .replace(/^\/\//, "https://");
    const url = new URL(expanded);
    if (
      url.protocol === "https:" &&
      /(^|\.)(steamstatic\.com|akamaihd\.net|steamcommunity\.com|steamusercontent\.com|steamcdn-a\.akamaihd\.net|steamcontent\.com)$/.test(
        url.hostname
      )
    )
      return url.href;
  } catch {
    /* no valid image */
  }
  return "";
}
function NewsThumbnail({
  image,
  appId,
}: {
  image: string;
  appId: string | null;
}) {
  const fallback =
    appId && /^\d{1,10}$/.test(appId)
      ? [
          "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/" +
            appId +
            "/header.jpg",
          "https://cdn.cloudflare.steamstatic.com/steam/apps/" +
            appId +
            "/header.jpg",
        ]
      : [];
  const sources = [...new Set([image, ...fallback].filter(Boolean))];
  const [index, setIndex] = useState(0);
  const src = sources[index];
  return (
    <div className="krysta-updates__thumb">
      <ToolsIcon size={32} />
      {src && (
        <img
          key={src}
          src={src}
          alt=""
          loading="lazy"
          onError={() => setIndex((i) => i + 1)}
        />
      )}
    </div>
  );
}
function parseContent(contents: string) {
  const bbImages =
    /\[img(?:\s+src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))|=([^\]]+))?\]([\s\S]*?)\[\/img\]/gi;
  let image = "";
  const decoded = contents
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
  const withoutImages = decoded.replace(
    bbImages,
    (_match, doubleQuoted, singleQuoted, unquoted, assigned, body) => {
      if (!image)
        image = safeImage(
          (
            doubleQuoted ||
            singleQuoted ||
            unquoted ||
            assigned ||
            body ||
            ""
          ).trim()
        );
      return "\n";
    }
  );
  const doc = new DOMParser().parseFromString(withoutImages, "text/html");
  doc
    .querySelectorAll("script,style,iframe,object,template")
    .forEach((node) => node.remove());
  if (!image) {
    for (const node of doc.querySelectorAll("img")) {
      image = safeImage(
        node.getAttribute("src") || node.getAttribute("data-src") || ""
      );
      if (image) break;
    }
  }
  if (!image) {
    const clan = decoded.match(
      /\{STEAM_CLAN_IMAGE\}\/[^\s"'<>\[\]]+\.(?:jpg|jpeg|png|webp|gif)/i
    )?.[0];
    if (clan) image = safeImage(clan);
  }
  doc.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
  doc
    .querySelectorAll("p,li,h1,h2,h3,div")
    .forEach((node) => node.append("\n"));
  const content = (doc.body.textContent ?? "")
    .replace(bbImages, "\n")
    .replace(
      /\[(?:\/?(?:p|h[1-6]|list|olist|quote|table|tr|br|hr))(?:[=\s][^\]]*)?\]/gi,
      "\n"
    )
    .replace(/\[\*\]/g, "\n• ")
    .replace(
      /\[\/?(?:img|b|i|u|s|strike|spoiler|noparse|code|url|td|th|previewyoutube|youtube|video)(?:[=\s][^\]]*)?\]/gi,
      ""
    )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { image, content };
}
export function KrystaGameUpdates({
  appId,
  title,
  shop,
  objectId,
  executablePath,
}: {
  appId: string;
  title: string;
  shop?: string;
  objectId?: string;
  executablePath?: string | null;
}) {
  const { i18n } = useTranslation();
  const pl = i18n.language.startsWith("pl");
  const [items, setItems] = useState<News[]>([]);
  const [resolved, setResolved] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [translated, setTranslated] = useState<{
    id: string;
    title: string;
    content: string;
  } | null>(null);
  const [translationState, setTranslationState] = useState<
    "idle" | "loading" | "unavailable"
  >("idle");
  const [original, setOriginal] = useState(false);
  const selected = items.find((item) => item.id === expanded);
  useEffect(() => {
    let active = true;
    setTranslated(null);
    setOriginal(false);
    setTranslationState("idle");
    if (!pl || !selected) return;
    setTranslationState("loading");
    void window.electron
      .translateKrystaNews(
        selected.title,
        parseContent(selected.contents).content
      )
      .then((result) => {
        if (active) {
          if (result) {
            setTranslated({ id: selected.id, ...result });
            setTranslationState("idle");
          } else setTranslationState("unavailable");
        }
      })
      .catch(() => {
        if (active) setTranslationState("unavailable");
      });
    return () => {
      active = false;
    };
  }, [pl, selected]);
  const [filter, setFilter] = useState<"patch" | "news" | "all">("patch");
  const filtered = items.filter(
    (item) => filter === "all" || item.category === filter
  );
  const parsedItems = useMemo(
    () => new Map(items.map((item) => [item.id, parseContent(item.contents)])),
    [items]
  );
  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    setItems([]);
    setResolved(null);
    setExpanded(null);
    void window.electron
      .getKrystaGameNews(appId, title)
      .then((result) => {
        if (active) {
          setItems(result.items);
          setResolved(result.appId);
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [appId, title, retry]);
  return (
    <section className="krysta-updates">
      <header className="krysta-updates__header">
        <h2>{pl ? "Aktualizacje i lista zmian" : "Updates and patch notes"}</h2>
        {resolved && <span>Steam</span>}
      </header>
      {shop && objectId && (
        <KrystaGameWatch
          key={shop + ":" + objectId}
          shop={shop}
          id={objectId}
          executablePath={executablePath}
        />
      )}
      <nav
        className="krysta-game-tabs"
        aria-label={pl ? "Typ wpisów" : "Entry type"}
      >
        {(["patch", "news", "all"] as const).map((type) => (
          <button
            key={type}
            type="button"
            aria-pressed={filter === type}
            onClick={() => {
              setFilter(type);
              setExpanded(null);
            }}
          >
            {type === "patch"
              ? pl
                ? "Aktualizacje gry"
                : "Game updates"
              : type === "news"
                ? pl
                  ? "Aktualności"
                  : "News"
                : pl
                  ? "Wszystkie"
                  : "All"}{" "}
            (
            {type === "all"
              ? items.length
              : items.filter((item) => item.category === type).length}
            )
          </button>
        ))}
      </nav>
      {loading ? (
        <p role="status">
          {pl ? "Pobieranie aktualizacji..." : "Loading updates..."}
        </p>
      ) : failed ? (
        <div>
          <p>
            {pl
              ? "Nie udało się pobrać aktualizacji."
              : "Could not fetch updates."}
          </p>
          <button type="button" onClick={() => setRetry((n) => n + 1)}>
            {pl ? "Spróbuj ponownie" : "Retry"}
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <p>
          {filter === "patch"
            ? pl
              ? "Nie znaleziono patchy w pobranych wpisach Steam."
              : "No patches found in the retrieved Steam posts."
            : pl
              ? "Brak wpisów w tej kategorii."
              : "No posts in this category."}
        </p>
      ) : (
        filtered.map((item) => {
          const { image, content } =
            parsedItems.get(item.id) ?? parseContent(item.contents);
          const preview = content.replace(/\s+/g, " ").trim();
          const isPatch = item.category === "patch";
          return (
            <article key={item.id} className="krysta-updates__article">
              <div className="krysta-updates__date">
                {item.date
                  ? new Date(item.date * 1000).toLocaleDateString(
                      pl ? "pl-PL" : "en-US",
                      { day: "numeric", month: "long", year: "numeric" }
                    )
                  : ""}
              </div>
              <button
                type="button"
                className="krysta-updates__card"
                aria-expanded={expanded === item.id}
                onClick={() =>
                  setExpanded(expanded === item.id ? null : item.id)
                }
              >
                <NewsThumbnail
                  key={item.id + ":" + image + ":" + resolved}
                  image={image}
                  appId={resolved}
                />
                <div className="krysta-updates__copy">
                  <small>
                    {isPatch
                      ? pl
                        ? "AKTUALIZACJA / LISTA ZMIAN"
                        : "UPDATE / PATCH NOTES"
                      : pl
                        ? "AKTUALNOŚCI GRY"
                        : "GAME NEWS"}
                  </small>
                  <strong>
                    {pl && !original && translated?.id === item.id
                      ? translated.title
                      : item.title}
                  </strong>
                  <p>
                    {preview.slice(0, 240)}
                    {preview.length > 240 ? "…" : ""}
                  </p>
                </div>
                <span aria-hidden="true">
                  {expanded === item.id ? "−" : "+"}
                </span>
              </button>
              {expanded === item.id && (
                <div className="krysta-updates__body">
                  {pl && translationState === "loading" && (
                    <small role="status">
                      Tłumaczenie na polski… Przy pierwszym użyciu pobierany
                      jest model językowy.
                    </small>
                  )}
                  {pl && translationState === "unavailable" && (
                    <small role="status">
                      Tłumaczenie lokalne niedostępne — wyświetlono oryginał.
                    </small>
                  )}
                  {pl && translated?.id === item.id && (
                    <button
                      type="button"
                      onClick={() => setOriginal((v) => !v)}
                    >
                      {original ? "Pokaż tłumaczenie" : "Pokaż oryginał"}
                    </button>
                  )}
                  <p>
                    {pl && !original && translated?.id === item.id
                      ? translated.content
                      : content}
                  </p>
                  {/^https:\/\//i.test(item.url) && (
                    <button
                      type="button"
                      onClick={() =>
                        void window.electron.openExternal(item.url)
                      }
                    >
                      {pl ? "Oryginalny wpis" : "Original announcement"}
                    </button>
                  )}
                </div>
              )}
            </article>
          );
        })
      )}
    </section>
  );
}
