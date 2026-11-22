import { useTranslation } from "react-i18next";
import {
  CatalogueGameRow,
  CatalogueRequestStatus,
  useCatalogueRequest,
} from "./catalogue-extras";
import { loadCatalogueTopGames } from "./catalogue-extras-data";
import { catalogueGameKey, useCatalogueWishlist } from "./catalogue-wishlist";

export function CatalogueWishlistPage() {
  const { t } = useTranslation("home");
  const games = useCatalogueWishlist()?.games ?? [];

  return (
    <section className="catalogue-extra">
      <header>
        <h1>{t("catalogue_wishlist")}</h1>
      </header>
      {games.length > 0 ? (
        <ul className="catalogue-extra__games">
          {games.map((game) => (
            <CatalogueGameRow game={game} key={catalogueGameKey(game)} />
          ))}
        </ul>
      ) : (
        <p className="catalogue-extra__status">
          {t("catalogue_wishlist_empty")}
        </p>
      )}
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
