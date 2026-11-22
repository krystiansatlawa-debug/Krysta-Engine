import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import {
  CheckIcon,
  FileDirectoryIcon,
  FilterIcon,
  HeartIcon,
  LockIcon,
} from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import type { GameCollection } from "@types";
import type { LibrarySource } from "./library-category";
import { SourceIcon } from "./source-icon";
import { useCloseOnLibraryScroll } from "./use-close-on-library-scroll";
import {
  LIBRARY_DROPDOWN_COLLISION_PADDING,
  LIBRARY_DROPDOWN_SIDE_OFFSET,
} from "./library-dropdown";
import "./library-toolbar-menu.scss";

/** The radio value of "every game", since a collection id is never empty. */
const ALL_GAMES = "";

interface LibraryFiltersMenuProps {
  gameViews: GameCollection[];
  selectedCollectionId: string | null;
  favoritesCollectionId: string;
  hiddenCollectionId: string;
  onCollectionSelect: (collectionId: string | null) => void;
  showSources: boolean;
  sources: readonly LibrarySource[];
  selectedSources: LibrarySource[];
  onSourcesChange: (sources: LibrarySource[]) => void;
  showPlatforms: boolean;
  platforms: string[];
  selectedPlatforms: string[];
  onPlatformsChange: (platforms: string[]) => void;
  showInstalledOnly: boolean;
  onShowInstalledOnlyChange: (showInstalledOnly: boolean) => void;
}

const toggleValue = <T extends string>(
  selected: T[],
  value: T,
  checked: boolean
) =>
  checked
    ? [...selected.filter((item) => item !== value), value]
    : selected.filter((item) => item !== value);

const getCollectionIcon = (isFavorites: boolean, isHidden: boolean) => {
  if (isFavorites) return HeartIcon;
  if (isHidden) return LockIcon;
  return FileDirectoryIcon;
};

/**
 * Game views, libraries, consoles and "installed only" behind one button.
 * Picking keeps the menu open, so several filters can be set in one go.
 */
export function LibraryFiltersMenu({
  gameViews,
  selectedCollectionId,
  favoritesCollectionId,
  hiddenCollectionId,
  onCollectionSelect,
  showSources,
  sources,
  selectedSources,
  onSourcesChange,
  showPlatforms,
  platforms,
  selectedPlatforms,
  onPlatformsChange,
  showInstalledOnly,
  onShowInstalledOnlyChange,
}: Readonly<LibraryFiltersMenuProps>) {
  const { t } = useTranslation(["library", "sidebar"]);
  const [open, setOpen] = useCloseOnLibraryScroll();

  const hasSelectedView = gameViews.some(
    ({ id }) => id === selectedCollectionId
  );
  const hasActiveFilters =
    hasSelectedView ||
    (showSources && selectedSources.length > 0) ||
    (showPlatforms && selectedPlatforms.length > 0) ||
    showInstalledOnly;

  const keepOpen = (event: Event) => event.preventDefault();

  const clearFilters = () => {
    if (hasSelectedView) onCollectionSelect(null);
    onSourcesChange([]);
    onPlatformsChange([]);
    onShowInstalledOnlyChange(false);
  };

  return (
    <DropdownMenuPrimitive.Root
      modal={false}
      open={open}
      onOpenChange={setOpen}
    >
      <DropdownMenuPrimitive.Trigger asChild>
        <button type="button" className="library-toolbar-menu__trigger">
          <FilterIcon size={16} />
          <span>{t("filters")}</span>
          {hasActiveFilters && (
            <span
              className="library-toolbar-menu__active-dot"
              role="img"
              aria-label={t("filters_active")}
            />
          )}
        </button>
      </DropdownMenuPrimitive.Trigger>

      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="end"
          sideOffset={LIBRARY_DROPDOWN_SIDE_OFFSET}
          collisionPadding={LIBRARY_DROPDOWN_COLLISION_PADDING}
          className="library-toolbar-menu__content"
        >
          <DropdownMenuPrimitive.Label className="library-toolbar-menu__label">
            {t("library_game_views")}
          </DropdownMenuPrimitive.Label>
          <DropdownMenuPrimitive.RadioGroup
            value={selectedCollectionId ?? ALL_GAMES}
            onValueChange={(value) =>
              onCollectionSelect(value === ALL_GAMES ? null : value)
            }
            className="library-toolbar-menu__list"
          >
            <DropdownMenuPrimitive.RadioItem
              value={ALL_GAMES}
              onSelect={keepOpen}
              className="library-toolbar-menu__item"
            >
              <span className="library-toolbar-menu__item-label">
                {t("all_games")}
              </span>
              <DropdownMenuPrimitive.ItemIndicator
                forceMount
                className="library-toolbar-menu__item-indicator"
              >
                <CheckIcon size={14} />
              </DropdownMenuPrimitive.ItemIndicator>
            </DropdownMenuPrimitive.RadioItem>

            {gameViews.map((collection) => {
              const isFavorites = collection.id === favoritesCollectionId;
              const isHidden = collection.id === hiddenCollectionId;
              const CollectionIcon = getCollectionIcon(isFavorites, isHidden);

              return (
                <DropdownMenuPrimitive.RadioItem
                  key={collection.id}
                  value={collection.id}
                  onSelect={keepOpen}
                  className="library-toolbar-menu__item"
                >
                  <CollectionIcon size={16} />
                  <span className="library-toolbar-menu__item-label">
                    {collection.name}
                  </span>
                  <span className="library-toolbar-menu__item-count">
                    {collection.gamesCount}
                  </span>
                  <DropdownMenuPrimitive.ItemIndicator
                    forceMount
                    className="library-toolbar-menu__item-indicator"
                  >
                    <CheckIcon size={14} />
                  </DropdownMenuPrimitive.ItemIndicator>
                </DropdownMenuPrimitive.RadioItem>
              );
            })}
          </DropdownMenuPrimitive.RadioGroup>

          {showSources && (
            <>
              <DropdownMenuPrimitive.Separator className="library-toolbar-menu__separator" />
              <DropdownMenuPrimitive.Label className="library-toolbar-menu__label">
                {t("libraries_label", { ns: "sidebar" })}
              </DropdownMenuPrimitive.Label>
              {sources.map((source) => (
                <DropdownMenuPrimitive.CheckboxItem
                  key={source}
                  checked={selectedSources.includes(source)}
                  onCheckedChange={(checked) => {
                    const next = toggleValue(
                      selectedSources,
                      source,
                      checked === true
                    );
                    onSourcesChange(
                      sources.filter((item) => next.includes(item))
                    );
                  }}
                  onSelect={keepOpen}
                  className="library-toolbar-menu__item"
                >
                  <SourceIcon source={source} />
                  <span className="library-toolbar-menu__item-label">
                    {t(`library_${source}`)}
                  </span>
                  <DropdownMenuPrimitive.ItemIndicator
                    forceMount
                    className="library-toolbar-menu__item-indicator"
                  >
                    <CheckIcon size={14} />
                  </DropdownMenuPrimitive.ItemIndicator>
                </DropdownMenuPrimitive.CheckboxItem>
              ))}
            </>
          )}

          {showPlatforms && (
            <>
              <DropdownMenuPrimitive.Separator className="library-toolbar-menu__separator" />
              <DropdownMenuPrimitive.Label className="library-toolbar-menu__label">
                {t("consoles_label", { ns: "sidebar" })}
              </DropdownMenuPrimitive.Label>
              <div className="library-toolbar-menu__list">
                {platforms.map((platform) => (
                  <DropdownMenuPrimitive.CheckboxItem
                    key={platform}
                    checked={selectedPlatforms.includes(platform)}
                    onCheckedChange={(checked) =>
                      onPlatformsChange(
                        toggleValue(
                          selectedPlatforms,
                          platform,
                          checked === true
                        )
                      )
                    }
                    onSelect={keepOpen}
                    className="library-toolbar-menu__item"
                  >
                    <span className="library-toolbar-menu__item-label">
                      {platform}
                    </span>
                    <DropdownMenuPrimitive.ItemIndicator
                      forceMount
                      className="library-toolbar-menu__item-indicator"
                    >
                      <CheckIcon size={14} />
                    </DropdownMenuPrimitive.ItemIndicator>
                  </DropdownMenuPrimitive.CheckboxItem>
                ))}
              </div>
            </>
          )}

          <DropdownMenuPrimitive.Separator className="library-toolbar-menu__separator" />
          <DropdownMenuPrimitive.CheckboxItem
            checked={showInstalledOnly}
            onCheckedChange={(checked) =>
              onShowInstalledOnlyChange(checked === true)
            }
            onSelect={keepOpen}
            className="library-toolbar-menu__switch-item"
          >
            <span className="library-toolbar-menu__item-label">
              {t("show_installed_only")}
            </span>
            <span className="library-toolbar-menu__switch" aria-hidden="true" />
          </DropdownMenuPrimitive.CheckboxItem>

          {hasActiveFilters && (
            <>
              <DropdownMenuPrimitive.Separator className="library-toolbar-menu__separator" />
              <DropdownMenuPrimitive.Item
                onSelect={clearFilters}
                className="library-toolbar-menu__item library-toolbar-menu__item--muted"
              >
                {t("clear_filters")}
              </DropdownMenuPrimitive.Item>
            </>
          )}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
