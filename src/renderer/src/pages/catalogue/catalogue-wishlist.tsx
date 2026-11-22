import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { BookmarkIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { useAppSelector, useToast } from "@renderer/hooks";
import type { ShopAssets } from "@types";

export type WishlistGame = Pick<
  ShopAssets,
  "shop" | "objectId" | "title" | "libraryImageUrl"
>;

export const catalogueGameKey = (
  game: Pick<WishlistGame, "shop" | "objectId">
) => `${game.shop}:${game.objectId}`;

const wishlistStorageKey = "krysta-catalogue-wishlist";

function readWishlist(storageKey: string): WishlistGame[] {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(storageKey) ?? "[]"
    );
    if (!Array.isArray(stored)) return [];

    const games = new Map<string, WishlistGame>();
    for (const item of stored) {
      if (
        !item ||
        !["steam", "epic", "launchbox"].includes(item.shop) ||
        typeof item.objectId !== "string" ||
        typeof item.title !== "string"
      ) {
        continue;
      }
      const game: WishlistGame = {
        shop: item.shop,
        objectId: item.objectId,
        title: item.title,
        libraryImageUrl:
          typeof item.libraryImageUrl === "string"
            ? item.libraryImageUrl
            : null,
      };
      games.set(catalogueGameKey(game), game);
    }
    return [...games.values()];
  } catch {
    return [];
  }
}

const WishlistContext = createContext<{
  games: WishlistGame[];
  savedKeys: Set<string>;
  toggle: (game: WishlistGame) => void;
} | null>(null);

function WishlistStorage({
  storageKey,
  children,
}: Readonly<{ storageKey: string; children: ReactNode }>) {
  const { t } = useTranslation("home");
  const { showErrorToast } = useToast();
  const [games, setGames] = useState(() => readWishlist(storageKey));

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) {
        setGames(readWishlist(storageKey));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storageKey]);

  const toggle = useCallback(
    (game: WishlistGame) => {
      const { shop, objectId, title, libraryImageUrl } = game;
      const current = readWishlist(storageKey);
      const key = catalogueGameKey(game);
      const withoutGame = current.filter(
        (saved) => catalogueGameKey(saved) !== key
      );
      const next =
        withoutGame.length === current.length
          ? [{ shop, objectId, title, libraryImageUrl }, ...current]
          : withoutGame;

      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
        setGames(next);
      } catch {
        showErrorToast(t("catalogue_wishlist_save_error"));
      }
    },
    [storageKey, showErrorToast, t]
  );

  const value = useMemo(
    () => ({
      games,
      toggle,
      savedKeys: new Set(games.map(catalogueGameKey)),
    }),
    [games, toggle]
  );

  return (
    <WishlistContext.Provider value={value}>
      {children}
    </WishlistContext.Provider>
  );
}

export function CatalogueWishlistProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const userId = useAppSelector((state) => state.userDetails.userDetails?.id);
  const storageKey = userId
    ? `${wishlistStorageKey}:user:${userId}`
    : `${wishlistStorageKey}:guest`;

  return (
    <WishlistStorage key={storageKey} storageKey={storageKey}>
      {children}
    </WishlistStorage>
  );
}

export function useCatalogueWishlist() {
  return useContext(WishlistContext);
}

export function CatalogueWishlistButton({
  game,
}: Readonly<{ game: WishlistGame }>) {
  const { t } = useTranslation("home");
  const wishlist = useCatalogueWishlist();
  if (!wishlist) return null;

  const saved = wishlist.savedKeys.has(catalogueGameKey(game));
  const label = t(
    saved ? "catalogue_wishlist_remove" : "catalogue_wishlist_add",
    {
      title: game.title,
    }
  );

  return (
    <button
      type="button"
      className="catalogue-wishlist-button"
      aria-label={label}
      aria-pressed={saved}
      title={label}
      onClick={() => wishlist.toggle(game)}
    >
      <BookmarkIcon size={16} aria-hidden="true" />
    </button>
  );
}
