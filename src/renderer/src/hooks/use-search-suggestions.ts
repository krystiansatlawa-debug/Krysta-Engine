import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAppSelector } from "./redux";
import { debounce } from "lodash-es";
import { logger } from "@renderer/logger";
import type { GameShop } from "@types";

export type SuggestionShop = "steam" | "launchbox";

export interface SearchSuggestion {
  title: string;
  objectId: string;
  shop: GameShop;
  iconUrl: string | null;
  source: "library" | "catalogue";
}

const normalizeTitle = (value: string) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function editDistance(a: string, b: string) {
  let row = Array.from({length: b.length+1}, (_, i) => i);
  for (let i=1;i<=a.length;i++) {
    const next = [i];
    for(let j=1;j<=b.length;j++) next.push(Math.min(next[j-1]+1,row[j]+1,row[j-1]+Number(a[i-1]!==b[j-1])));
    row=next;
  }
  return row[b.length];
}
export function useSearchSuggestions(
  query: string,
  isOnLibraryPage: boolean,
  enabled: boolean = true,
  shop: SuggestionShop = "steam"
) {
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const library = useAppSelector((state) => state.library.value);
  const abortControllerRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<Map<string, {at:number; games:SearchSuggestion[]}>>(new Map());
  const librarySearchIndex = useMemo(
    () =>
      library
        .filter((game) => Boolean(game.title))
        .map((game) => ({
          titleLower: normalizeTitle(game.title),
          game,
        })),
    [library]
  );

  const getLibrarySuggestions = useCallback(
    (searchQuery: string, limit: number = 3): SearchSuggestion[] => {
      const normalizedQuery = normalizeTitle(searchQuery.trim());
      if (normalizedQuery.length < 2) return [];

      const matches: SearchSuggestion[] = [];

      for (const { game, titleLower } of librarySearchIndex) {
        if (matches.length >= limit) break;

        if (titleLower.includes(normalizedQuery) || (normalizedQuery.length >= 4 && normalizedQuery.length <= 40 && titleLower.split(/\s+/).some(word => Math.abs(word.length-normalizedQuery.length)<=2 && editDistance(word,normalizedQuery)<= (normalizedQuery.length>=7?2:1)))) {
          matches.push({
            title: game.title,
            objectId: game.objectId,
            shop: game.shop,
            iconUrl: game.iconUrl,
            source: "library",
          });
          continue;
        }

        let queryIndex = 0;

        for (
          let index = 0;
          index < titleLower.length && queryIndex < normalizedQuery.length;
          index++
        ) {
          if (titleLower[index] === normalizedQuery[queryIndex]) {
            queryIndex++;
          }
        }

        if (queryIndex === normalizedQuery.length) {
          matches.push({
            title: game.title,
            objectId: game.objectId,
            shop: game.shop,
            iconUrl: game.iconUrl,
            source: "library",
          });
        }
      }

      return matches;
    },
    [librarySearchIndex]
  );

  const fetchCatalogueSuggestions = useCallback(
    async (
      searchQuery: string,
      limit: number = 3,
      shopParam: SuggestionShop = "steam"
    ) => {
      if (!searchQuery.trim() || searchQuery.length < 2) {
        setSuggestions([]);
        setIsLoading(false);
        return;
      }

      const cacheKey = `${searchQuery.toLowerCase()}_${limit}_${shopParam}`;
      const cachedResults = cacheRef.current.get(cacheKey);

      if (cachedResults && Date.now()-cachedResults.at < 120000) {
        setSuggestions(cachedResults.games);
        setIsLoading(false);
        return;
      }

      abortControllerRef.current?.abort();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setIsLoading(true);

      try {
        const response = await window.electron.hydraApi.get<
          {
            title: string;
            objectId: string;
            shop: GameShop;
            iconUrl: string | null;
          }[]
        >("/catalogue/search/suggestions", {
          params: {
            query: searchQuery,
            limit,
            shop: shopParam,
          },
          needsAuth: false,
        });

        if (abortController.signal.aborted) return;

        const catalogueSuggestions: SearchSuggestion[] = response.map(
          (item) => ({
            ...item,
            source: "catalogue" as const,
          })
        );

        cacheRef.current.delete(cacheKey);
        cacheRef.current.set(cacheKey, {at:Date.now(),games:catalogueSuggestions.slice(0,limit)});
        if (cacheRef.current.size > 40) { const oldest = cacheRef.current.keys().next().value; if (oldest !== undefined) cacheRef.current.delete(oldest); }
        setSuggestions(catalogueSuggestions);
      } catch (error) {
        if (!abortController.signal.aborted) {
          setSuggestions([]);
          logger.error("Failed to fetch catalogue suggestions", error);
        }
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    },
    []
  );

  const debouncedFetchCatalogue = useRef(
    debounce(fetchCatalogueSuggestions, 300)
  ).current;

  useEffect(() => {
    setSuggestions([]);
    if (!enabled || !query || query.length < 2) {
      setSuggestions([]);
      setIsLoading(false);
      abortControllerRef.current?.abort();
      debouncedFetchCatalogue.cancel();
      return;
    }

    if (isOnLibraryPage) {
      const librarySuggestions = getLibrarySuggestions(query, 3);
      setSuggestions(librarySuggestions);
      setIsLoading(false);
    } else {
      debouncedFetchCatalogue(query, 3, shop);
    }

    return () => {
      debouncedFetchCatalogue.cancel();
      abortControllerRef.current?.abort();
    };
  }, [
    query,
    isOnLibraryPage,
    enabled,
    shop,
    getLibrarySuggestions,
    debouncedFetchCatalogue,
  ]);

  const combined = useMemo(() => enabled && !isOnLibraryPage ? Array.from(new Map([...suggestions, ...getLibrarySuggestions(query, 3)].map(game => [`${game.shop}:${game.objectId}`, game])).values()).slice(0,6) : suggestions, [enabled, isOnLibraryPage, suggestions, query, getLibrarySuggestions]);
  return { suggestions: combined, isLoading };
}
