import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileDirectoryIcon, PlusIcon, StackIcon } from "@primer/octicons-react";
import cn from "classnames";

import { CreateCollectionModal } from "@renderer/components";
import { useCollectionContextMenu } from "@renderer/context";
import { selectGroupedLibrary } from "@renderer/features";
import { getGameCollectionIds } from "@renderer/helpers";
import {
  useAppSelector,
  useGameCollections,
  useLibraryCollectionSelection,
  useUserDetails,
} from "@renderer/hooks";
import { AuthPage } from "@shared";

export function SidebarLibraryCollections() {
  const { t } = useTranslation(["library", "sidebar"]);
  const { collections, isLoading, hasLoaded, hasFailed, loadCollections } =
    useGameCollections();
  const { selectedCollectionId, selectCollection } =
    useLibraryCollectionSelection();
  const { userDetails } = useUserDetails();
  const { openCollectionContextMenu } = useCollectionContextMenu();
  const games = useAppSelector(selectGroupedLibrary);
  const [showCreate, setShowCreate] = useState(false);

  const counts = useMemo(() => {
    const byCollection = new Map<string, number>();
    for (const game of games) {
      for (const id of getGameCollectionIds(game)) {
        byCollection.set(id, (byCollection.get(id) ?? 0) + 1);
      }
    }
    return byCollection;
  }, [games]);

  const createLabel = t("create_collection", { ns: "sidebar" });
  const openCreate = () => {
    if (!userDetails) {
      void window.electron.openAuthWindow(AuthPage.SignIn);
      return;
    }
    setShowCreate(true);
  };

  return (
    <nav
      className="sidebar__section sidebar__collections"
      aria-label={t("collections")}
    >
      <div className="sidebar__collections-heading">
        <h2>{t("collections")}</h2>
        <button
          type="button"
          onClick={openCreate}
          aria-label={createLabel}
          title={createLabel}
        >
          <PlusIcon size={16} />
        </button>
      </div>

      <ul className="sidebar__menu sidebar__collections-list">
        <li
          className={cn("sidebar__menu-item", {
            "sidebar__menu-item--active": selectedCollectionId === null,
          })}
        >
          <button
            type="button"
            className="sidebar__menu-item-button"
            aria-current={selectedCollectionId === null ? "true" : undefined}
            onClick={() => selectCollection(null)}
          >
            <StackIcon size={16} />
            <span className="sidebar__menu-item-button-label">
              {t("all_games")}
            </span>
            <span className="sidebar__collection-count">{games.length}</span>
          </button>
        </li>
        {userDetails &&
          collections.map((collection) => {
            const isSelected = collection.id === selectedCollectionId;
            return (
              <li
                key={collection.id}
                className={cn("sidebar__menu-item", {
                  "sidebar__menu-item--active": isSelected,
                })}
              >
                <button
                  type="button"
                  className="sidebar__menu-item-button"
                  title={collection.name}
                  aria-current={isSelected ? "true" : undefined}
                  onClick={() => selectCollection(collection.id)}
                  onContextMenu={(event) =>
                    openCollectionContextMenu(event, collection)
                  }
                >
                  <FileDirectoryIcon size={16} />
                  <span className="sidebar__menu-item-button-label">
                    {collection.name}
                  </span>
                  <span className="sidebar__collection-count">
                    {counts.get(collection.id) ?? 0}
                  </span>
                </button>
              </li>
            );
          })}
      </ul>

      {userDetails &&
        !isLoading &&
        collections.length === 0 &&
        (hasFailed ? (
          <button
            type="button"
            className="sidebar__collections-retry"
            onClick={() => void loadCollections()}
          >
            {t("retry_library_collections")}
          </button>
        ) : hasLoaded ? (
          <p className="sidebar__collections-empty">
            {t("empty_library_collections")}
          </p>
        ) : null)}

      <CreateCollectionModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(collection) => selectCollection(collection.id)}
      />
    </nav>
  );
}
