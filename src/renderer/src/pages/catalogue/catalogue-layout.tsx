import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet } from "react-router-dom";
import {
  BookmarkIcon,
  CalendarIcon,
  SearchIcon,
  TelescopeIcon,
  TrophyIcon,
} from "@primer/octicons-react";
import { setHeaderTitle } from "@renderer/features";
import { useAppDispatch } from "@renderer/hooks";
import { CatalogueWishlistProvider } from "./catalogue-wishlist";
import "./catalogue-discover.scss";

export function CatalogueLayout() {
  const { t } = useTranslation(["home", "sidebar"]);
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch(setHeaderTitle(t("catalogue", { ns: "sidebar" })));
  }, [dispatch, t]);

  return (
    <div className="catalogue-layout">
      <nav
        className="catalogue-layout__tabs"
        aria-label={t("catalogue", { ns: "sidebar" })}
      >
        <NavLink end to="/catalogue">
          <TelescopeIcon /> {t("catalogue_discover")}
        </NavLink>
        <NavLink to="/catalogue/search">
          <SearchIcon /> {t("catalogue_search")}
        </NavLink>
        <NavLink to="/catalogue/wishlist">
          <BookmarkIcon /> {t("catalogue_wishlist")}
        </NavLink>
        <NavLink to="/catalogue/top">
          <TrophyIcon /> {t("catalogue_top")}
        </NavLink>
        <NavLink to="/catalogue/releases">
          <CalendarIcon /> {t("catalogue_calendar")}
        </NavLink>
      </nav>
      <CatalogueWishlistProvider>
        <Outlet />
      </CatalogueWishlistProvider>
    </div>
  );
}
