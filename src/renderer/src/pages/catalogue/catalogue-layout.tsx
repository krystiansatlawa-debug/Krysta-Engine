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
import { CatalogueCategoriesMenu } from "./catalogue-categories-menu";
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
              <CatalogueCategoriesMenu
                onChooseTag={(tag) => browse({ tags: [tag] })}
              />
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
