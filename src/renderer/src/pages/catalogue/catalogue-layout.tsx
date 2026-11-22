import { type MouseEvent, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useMatch, useNavigate } from "react-router-dom";
import { ChevronDownIcon } from "@primer/octicons-react";
import {
  clearFilters,
  setFilters,
  setHeaderTitle,
  setMode,
} from "@renderer/features";
import { useAppDispatch } from "@renderer/hooks";
import type { CatalogueSearchPayload } from "@types";
import { gameGenres, gameTagGroups } from "./browse-categories";
import { CatalogueStoreSearch } from "./catalogue-store-search";
import { CatalogueWishlistProvider } from "./catalogue-wishlist";
import "./catalogue-discover.scss";

export function CatalogueLayout() {
  const { t } = useTranslation(["home", "sidebar"]);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const isSearch = Boolean(useMatch("/catalogue/search"));

  useEffect(() => {
    dispatch(setHeaderTitle(t("catalogue", { ns: "sidebar" })));
  }, [dispatch, t]);

  const browse = (filters: Partial<CatalogueSearchPayload> = {}) => {
    dispatch(setMode("modern"));
    dispatch(clearFilters());
    dispatch(setFilters(filters));
    navigate("/catalogue/search");
  };

  const closeMenu = (event: MouseEvent<HTMLAnchorElement>) =>
    event.currentTarget.closest("details")?.removeAttribute("open");

  return (
    <div className="catalogue-layout">
      {!isSearch && (
        <div className="catalogue-layout__toolbar">
          <div className="catalogue-layout__toolbar-inner">
            <nav
              className="catalogue-layout__tabs"
              aria-label={t("catalogue", { ns: "sidebar" })}
            >
              <details>
                <summary>
                  {t("store_browse")} <ChevronDownIcon size={12} />
                </summary>
                <div className="catalogue-layout__menu">
                  <NavLink onClick={closeMenu} end to="/catalogue">
                    {t("catalogue_discover")}
                  </NavLink>
                  <button type="button" onClick={() => browse()}>
                    {t("store_all_games", { ns: "catalogue" })}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      browse({ sortBy: "releaseDate", sortOrder: "desc" })
                    }
                  >
                    {t("catalogue_new")}
                  </button>
                  <NavLink onClick={closeMenu} to="/catalogue/top">
                    {t("catalogue_top")}
                  </NavLink>
                  <NavLink onClick={closeMenu} to="/catalogue/releases">
                    {t("catalogue_calendar")}
                  </NavLink>
                </div>
              </details>
              <details>
                <summary>
                  {t("store_recommendations")} <ChevronDownIcon size={12} />
                </summary>
                <div className="catalogue-layout__menu">
                  <NavLink onClick={closeMenu} end to="/catalogue">
                    {t("store_featured")}
                  </NavLink>
                  <NavLink onClick={closeMenu} to="/catalogue/top">
                    {t("catalogue_top")}
                  </NavLink>
                  <NavLink onClick={closeMenu} to="/catalogue/wishlist">
                    {t("catalogue_wishlist")}
                  </NavLink>
                </div>
              </details>
              <details>
                <summary>
                  {t("store_categories")} <ChevronDownIcon size={12} />
                </summary>
                <div className="catalogue-layout__menu catalogue-layout__menu--columns">
                  {gameGenres.map((genre) => (
                    <button
                      key={genre}
                      type="button"
                      onClick={() => browse({ genres: [genre] })}
                    >
                      {t(`browse_labels.${genre}`, { defaultValue: genre })}
                    </button>
                  ))}
                </div>
              </details>
              <details>
                <summary>
                  {t("store_play_styles")} <ChevronDownIcon size={12} />
                </summary>
                <div className="catalogue-layout__menu catalogue-layout__menu--columns">
                  {gameTagGroups[0].tags.map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => browse({ tags: [id] })}
                    >
                      {t(`browse_labels.${label}`, { defaultValue: label })}
                    </button>
                  ))}
                </div>
              </details>
              <details>
                <summary>
                  {t("store_sections")} <ChevronDownIcon size={12} />
                </summary>
                <div className="catalogue-layout__menu">
                  <NavLink onClick={closeMenu} to="/catalogue/wishlist">
                    {t("catalogue_wishlist")}
                  </NavLink>
                  <NavLink onClick={closeMenu} to="/catalogue/top">
                    {t("catalogue_top")}
                  </NavLink>
                  <NavLink onClick={closeMenu} to="/catalogue/releases">
                    {t("catalogue_calendar")}
                  </NavLink>
                </div>
              </details>
            </nav>
            <CatalogueStoreSearch />
          </div>
        </div>
      )}
      <CatalogueWishlistProvider>
        <Outlet />
      </CatalogueWishlistProvider>
    </div>
  );
}
