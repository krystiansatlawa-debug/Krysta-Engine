import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

export const LIBRARY_COLLECTION_STORAGE_KEY = "library-collection";

export function useLibraryCollectionSelection() {
  const [searchParams, setSearchParams] = useSearchParams();

  const selectCollection = useCallback(
    (collectionId: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (collectionId) {
        next.set("collection", collectionId);
        localStorage.setItem(LIBRARY_COLLECTION_STORAGE_KEY, collectionId);
      } else {
        next.delete("collection");
        localStorage.removeItem(LIBRARY_COLLECTION_STORAGE_KEY);
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  return {
    selectedCollectionId: searchParams.get("collection"),
    selectCollection,
  };
}
