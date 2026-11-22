import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useMatch, useNavigate } from "react-router-dom";
import { SearchIcon } from "@primer/octicons-react";

import { clearFilters, setFilters, setMode } from "@renderer/features";
import { buildGameDetailsPath } from "@renderer/helpers";
import {
  useAppDispatch,
  useAppSelector,
  useSearchSuggestions,
} from "@renderer/hooks";

export function CatalogueStoreSearch() {
  const { t } = useTranslation("catalogue");
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const isResults = Boolean(useMatch("/catalogue/search"));
  const { title, mode } = useAppSelector(
    ({ catalogueSearch }) => ({
      title: catalogueSearch.filters.title,
      mode: catalogueSearch.mode,
    }),
    (previous, next) =>
      previous.title === next.title && previous.mode === next.mode
  );

  const [query, setQuery] = useState(isResults ? title : "");
  const [open, setOpen] = useState(false);
  const { suggestions } = useSearchSuggestions(
    query.trim(),
    false,
    open,
    isResults && mode === "classics" ? "launchbox" : "steam"
  );

  useEffect(() => {
    setQuery(isResults ? title : "");
    setOpen(false);
  }, [isResults, title]);

  return (
    <form
      className="catalogue-store-search"
      role="search"
      aria-label={t("store_search")}
      onSubmit={(event) => {
        event.preventDefault();
        setOpen(false);
        if (!isResults) {
          dispatch(setMode("modern"));
          dispatch(clearFilters());
        }
        dispatch(setFilters({ title: query.trim() }));
        navigate("/catalogue/search");
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <input
        type="search"
        aria-label={t("store_search")}
        placeholder={t("store_search_placeholder")}
        value={query}
        maxLength={255}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setOpen(false);
          }
        }}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
      />
      <button
        type="submit"
        aria-label={t("store_search")}
        title={t("store_search")}
      >
        <SearchIcon />
      </button>
      {open && suggestions.length > 0 && (
        <ul
          className="catalogue-store-search__suggestions"
          aria-label={t("store_suggestions")}
        >
          {suggestions.map((game) => (
            <li key={`${game.shop}:${game.objectId}`}>
              <Link
                to={buildGameDetailsPath(game)}
                onClick={() => setOpen(false)}
              >
                {game.iconUrl && (
                  <img src={game.iconUrl} alt="" width={32} height={32} />
                )}
                {game.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
