import { useEffect, useMemo, useState } from "react";
import { useAppSelector } from "@renderer/hooks";
import type { ShopDetailsWithAssets } from "@types";
import { useTranslation } from "react-i18next";
import {
  CatalogueGameRow,
  CatalogueRequestStatus,
  useCatalogueRequest,
} from "./catalogue-extras";
import { loadCatalogueTopGames } from "./catalogue-extras-data";
import { catalogueGameKey, useCatalogueWishlist } from "./catalogue-wishlist";

export function CatalogueWishlistPage() {
  const { t, i18n } = useTranslation("home");
  const pl = i18n.language.startsWith("pl");
  const wishlist = useCatalogueWishlist();
  const games = wishlist?.games ?? [];
  const library = useAppSelector(state => state.library.value);
  const owned = useMemo(() => new Set(library.filter(g=>!g.isDeleted).flatMap(g=>[catalogueGameKey(g), ...(g.catalogueGame ? [catalogueGameKey(g.catalogueGame)] : [])])), [library]);
  const [query,setQuery] = useState("");
  const [unownedOnly,setUnownedOnly] = useState(false);
  const [alphabetical,setAlphabetical] = useState(false);
  const [details,setDetails] = useState<Record<string,ShopDetailsWithAssets|null>>({});
  const [checking,setChecking] = useState(false);
  const [attempt,setAttempt] = useState(0);
  const [limit,setLimit] = useState(20);
  const visible = useMemo(()=>{const filtered=games.filter(g=>g.title.toLowerCase().includes(query.toLowerCase()) && (!unownedOnly || !owned.has(catalogueGameKey(g))));return alphabetical?filtered.sort((a,b)=>a.title.localeCompare(b.title,i18n.language)):filtered;},[games,query,unownedOnly,owned,alphabetical,i18n.language]);
  const page = visible.slice(0,limit);
  const pageKey = page.map(catalogueGameKey).join("|");
  useEffect(()=>{if (!attempt) return; let active=true; setChecking(true); setDetails({}); const load=async()=>{for(let i=0;i<page.length && active;i+=3){const batch=await Promise.all(page.slice(i,i+3).map(async game=>[catalogueGameKey(game),await window.electron.getGameShopDetails(game.objectId,game.shop,i18n.language.split("-")[0]).catch(()=>null)] as const));if(active)setDetails(prev=>({...prev,...Object.fromEntries(batch)}));}};void load().finally(()=>{if(active)setChecking(false);});return()=>{active=false;};},[attempt,pageKey,i18n.language]);

  return (
    <section className="catalogue-extra">
      <header>
        <h1>{t("catalogue_wishlist")}</h1>
      </header>
      <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"center"}}><input aria-label={pl?"Szukaj na liście":"Search wishlist"} value={query} onChange={e=>{setQuery(e.target.value);setLimit(20);}} /><label><input type="checkbox" checked={unownedOnly} onChange={e=>setUnownedOnly(e.target.checked)}/>{pl?"Tylko spoza biblioteki":"Not in library"}</label><label><input type="checkbox" checked={alphabetical} onChange={e=>setAlphabetical(e.target.checked)}/> A–Z</label><button type="button" disabled={checking || !page.length} onClick={()=>setAttempt(v=>v+1)}>{checking?(pl?"Sprawdzanie…":"Checking…"):(pl?"Sprawdź premiery i języki":"Check releases and languages")}</button></div>
      {page.length > 0 ? (
        <ul className="catalogue-extra__games">
          {page.map(game => {const key=catalogueGameKey(game);const detail=details[key];return <CatalogueGameRow game={game} key={key} prefix={<span>{owned.has(key)?(pl?"W bibliotece":"In library"):""}{detail?.release_date?.date && <small> {detail.release_date.coming_soon?(pl?"Premiera: ":"Coming: "):(pl?"Wydano: ":"Released: ")}{detail.release_date.date}</small>}{detail?.supported_languages && /\\bPolish\\b|polski/i.test(detail.supported_languages) && <small> PL</small>}{detail===null && <small>{pl?" Brak danych":" No data"}</small>}</span>} />;})}
        </ul>
      ) : (
        <p className="catalogue-extra__status">
          {t("catalogue_wishlist_empty")}
        </p>
      )}
      {visible.length>limit && <button type="button" onClick={()=>setLimit(v=>v+20)}>{pl?"Pokaż więcej":"Show more"}</button>}
    </section>
  );
}

export function CatalogueTopPage() {
  const { t } = useTranslation("home");
  const { data: games, retry } = useCatalogueRequest(loadCatalogueTopGames);

  return (
    <section className="catalogue-extra">
      <header>
        <h1>{t("catalogue_top")}</h1>
        <p>{t("catalogue_top_basis")}</p>
      </header>
      {!games ? (
        <CatalogueRequestStatus loading={games === undefined} retry={retry} />
      ) : games.length > 0 ? (
        <ol className="catalogue-extra__games">
          {games.map((game, index) => (
            <CatalogueGameRow
              game={game}
              key={catalogueGameKey(game)}
              prefix={
                <span className="catalogue-extra__rank">{index + 1}</span>
              }
            />
          ))}
        </ol>
      ) : (
        <p className="catalogue-extra__status">{t("no_results")}</p>
      )}
    </section>
  );
}
