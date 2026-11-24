import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAppSelector } from "@renderer/hooks";
import { buildGameDetailsPath } from "@renderer/helpers";
import { fetchSimilarGames, type SimilarGame } from "@renderer/hooks/similar-games";
import type { LibraryGame } from "@types";

const key = (game: {shop: string; objectId: string}) => game.shop + ":" + game.objectId;
const identity = (game: LibraryGame) => game.catalogueGame ?? game;
const time = (game: LibraryGame) => Math.max(game.playTimeInMilliseconds || 0, game.steamPlayTimeInMilliseconds || 0, game.epicPlayTimeInMilliseconds || 0);
export function CataloguePersonalization() {
  const { i18n } = useTranslation();
  const pl = i18n.language.startsWith("pl");
  const library = useAppSelector(state => state.library.value);
  const owned = useMemo(() => new Set(library.filter(g => !g.isDeleted).flatMap(g => [key(g), key(identity(g))])), [library]);
  const seeds = useMemo(() => {
    const eligible = library.filter(g => !g.isDeleted && ["steam", "launchbox"].includes(identity(g).shop));
    const recent = [...eligible].sort((a,b) => Number(new Date(b.lastTimePlayed ?? 0)) - Number(new Date(a.lastTimePlayed ?? 0)))[0];
    const mostPlayed = [...eligible].sort((a,b) => time(b)-time(a))[0];
    return Array.from(new Map([recent, mostPlayed, eligible.find(g => g.favorite), eligible[0]].filter((g): g is LibraryGame => Boolean(g)).map(g => [key(identity(g)), g])).values()).slice(0,3);
  }, [library]);
  const seedKey = seeds.map(g => key(identity(g))).join("|");
  const [recommendations, setRecommendations] = useState<SimilarGame[]>([]);
  const [genres, setGenres] = useState<string[]>([]);
  const [hidden, setHidden] = useState<string[]>(() => { try { const value = JSON.parse(localStorage.getItem("krysta-catalogue-hidden") ?? "[]"); return Array.isArray(value) ? value.filter(v => typeof v === "string").slice(0,200) : []; } catch { return []; } });
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setRecommendations([]); setGenres([]); setCursor(0);
    if (!seedKey) return;
    setLoading(true);
    const load = async () => {
      const output: SimilarGame[] = [];
      const preferences = new Map<string,number>();
      for (const seed of seeds) {
        if (!active) return;
        const game = identity(seed);
        const [similar, details] = await Promise.all([
          fetchSimilarGames(game, (path, options) => window.electron.hydraApi.get<unknown>(path, options)).catch(() => []),
          window.electron.getGameShopDetails(game.objectId, game.shop, i18n.language.split("-")[0]).catch(() => null)
        ]);
        output.push(...similar);
        for (const genre of details?.genres ?? []) preferences.set(genre.name, (preferences.get(genre.name) ?? 0) + 1 + Math.log1p(time(seed)/3600000));
      }
      if (active) { setRecommendations(Array.from(new Map(output.map(g => [key(g),g])).values())); setGenres([...preferences].sort((a,b)=>b[1]-a[1]).slice(0,5).map(g=>g[0])); }
    };
    void load().finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [seedKey, i18n.language]);
  useEffect(() => { try { localStorage.setItem("krysta-catalogue-hidden", JSON.stringify(hidden)); } catch {} }, [hidden]);
  const queue = recommendations.filter(g => !owned.has(key(g)) && !hidden.includes(key(g)));
  const current = queue[cursor % Math.max(queue.length,1)];
  if (!seeds.length) return null;
  return <section className="catalogue-discover__shelf catalogue-store-width">
    <header className="catalogue-discover__heading"><h2>{pl ? "Dla Ciebie" : "For you"}</h2>{hidden.length > 0 && <button type="button" onClick={() => setHidden([])}>{pl ? "Przywróć ukryte" : "Restore hidden"}</button>}</header>
    <small>{pl ? "Na podstawie biblioteki, czasu gry i ostatniej aktywności" : "Based on library, playtime and recent activity"}</small>
    {genres.length > 0 && <p>{pl ? "Ulubione gatunki" : "Preferred genres"}: {genres.join(", ")}</p>}
    {loading && <p role="status">{pl ? "Ładowanie rekomendacji…" : "Loading recommendations…"}</p>}
    {!loading && !current && <p>{pl ? "Brak nowych rekomendacji" : "No new recommendations"}</p>}
    {current && <div className="catalogue-discover__games"><h3>{pl ? "Kolejka odkrywania" : "Discovery queue"} ({cursor % queue.length + 1}/{queue.length})</h3>
    <article className="catalogue-discover__game"><Link to={buildGameDetailsPath(current)}>{current.libraryImageUrl && <img src={current.libraryImageUrl} alt="" loading="lazy" />}<span><strong>{current.title}</strong></span></Link><button type="button" onClick={() => setCursor(v => v+1)}>{pl ? "Następna" : "Next"}</button><button type="button" onClick={() => setHidden(v => [...v.filter(k=>k!==key(current)),key(current)].slice(-200))}>{pl ? "Nie interesuje mnie" : "Not interested"}</button></article>
    {queue.slice(0,8).map(g => <article key={key(g)} className="catalogue-discover__game"><Link to={buildGameDetailsPath(g)}>{g.libraryImageUrl && <img src={g.libraryImageUrl} alt="" loading="lazy" />}<span><strong>{g.title}</strong></span></Link><button type="button" onClick={() => setHidden(v => [...v.filter(k=>k!==key(g)),key(g)].slice(-200))}>{pl ? "Ukryj" : "Hide"}</button></article>)}</div>}
  </section>;
}
