import { ChevronDownIcon, ChevronRightIcon } from "@primer/octicons-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { getSteamTagLabel } from "@shared";
import { gameTagGroups } from "./browse-categories";

const featuredCategories = [
  { id: 599, name: "Simulation", artAppId: 227300 },
  { id: 1659, name: "Zombies", artAppId: 108600 },
  { id: 1774, name: "Shooter", artAppId: 730 },
  { id: 1663, name: "FPS", artAppId: 782330 },
  { id: 4168, name: "Military", artAppId: 107410 },
  { id: 1662, name: "Survival", artAppId: 305620 },
];

const quickTags = [
  [1695, "Open World"],
  [1667, "Horror"],
  [4175, "Realistic"],
  [3810, "Sandbox"],
  [12472, "Management"],
  [3839, "First-Person"],
  [1685, "Co-op"],
  [1742, "Story Rich"],
  [122, "RPG"],
  [4166, "Atmospheric"],
] as const;

const genreColumns: readonly (readonly (readonly [number, string])[])[] = [
  [
    [1663, "FPS"],
    [3814, "Third-Person Shooter"],
    [1646, "Hack and Slash"],
  ],
  [
    [1738, "Hidden Object"],
    [597, "Casual"],
    [1628, "Metroidvania"],
  ],
  [
    [4231, "Action RPG"],
    [21725, "Tactical RPG"],
    [4434, "JRPG"],
  ],
  [
    [7332, "Base Building"],
    [255534, "Automation"],
    [9551, "Dating Sim"],
  ],
  [
    [1741, "Turn-Based Strategy"],
    [1676, "RTS"],
    [1645, "Tower Defense"],
  ],
  [
    [701, "Sports"],
    [699, "Racing"],
    [1644, "Driving"],
  ],
  [
    [1667, "Horror"],
    [3942, "Sci-fi"],
    [1755, "Space"],
  ],
] as const;

export function CatalogueCategoriesMenu({
  onChooseTag,
}: Readonly<{ onChooseTag: (id: number) => void }>) {
  const { t, i18n } = useTranslation("home");
  const { key } = useLocation();
  const details = useRef<HTMLDetailsElement>(null);
  const [expanded, setExpanded] = useState(false);
  const label = (id: number, name: string) =>
    getSteamTagLabel(id, i18n.language, name);

  useEffect(() => {
    const menu = details.current;
    if (!menu) return;

    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.contains(event.target)) {
        menu.open = false;
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !menu.open) return;
      menu.open = false;
      menu.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  useEffect(() => {
    if (details.current) details.current.open = false;
  }, [key]);

  const choose = (id: number) => {
    if (details.current) details.current.open = false;
    onChooseTag(id);
  };

  return (
    <details className="catalogue-layout__categories" ref={details}>
      <summary>
        {t("store_categories")} <ChevronDownIcon size={12} />
      </summary>
      <div className="catalogue-category-menu">
        <div className="catalogue-category-menu__body">
          <h2>{t("store_popular_categories")}</h2>
          <div className="catalogue-category-menu__tiles">
            {featuredCategories.map(({ id, name, artAppId }) => (
              <button type="button" key={id} onClick={() => choose(id)}>
                <img
                  src={`https://shared.steamstatic.com/store_item_assets/steam/apps/${artAppId}/header.jpg`}
                  alt=""
                />
                <span>{label(id, name)}</span>
              </button>
            ))}
          </div>
          <div className="catalogue-category-menu__quick-tags">
            {quickTags.map(([id, name]) => (
              <button type="button" key={id} onClick={() => choose(id)}>
                {label(id, name)}
              </button>
            ))}
            <Link to="/catalogue/tags">
              {t("store_show_all_tags")} <ChevronRightIcon size={12} />
            </Link>
          </div>
          <div className="catalogue-category-menu__heading">
            <h2>{t("store_genres_and_themes")}</h2>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {t(
                expanded
                  ? "store_collapse_categories"
                  : "store_expand_categories"
              )}{" "}
              <ChevronDownIcon size={12} />
            </button>
          </div>
          <div className="catalogue-category-menu__columns">
            {genreColumns.map((column) => (
              <div key={column[0][0]}>
                {column.map(([id, name]) => (
                  <button type="button" key={id} onClick={() => choose(id)}>
                    {label(id, name)}
                  </button>
                ))}
              </div>
            ))}
          </div>
          {expanded && (
            <div className="catalogue-category-menu__expanded">
              {gameTagGroups.map(({ label: group, tags }) => (
                <div key={group}>
                  <h3>{t(group)}</h3>
                  {tags.map(([id, name]) => (
                    <button type="button" key={id} onClick={() => choose(id)}>
                      {label(id, name)}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </details>
  );
}
