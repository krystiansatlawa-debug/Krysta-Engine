import { catalogueSearchSlice } from "@renderer/features/catalogue-search";
import type { CatalogueSearchPayload, CatalogueSearchResult } from "@types";

type CataloguePage = { edges: CatalogueSearchResult[]; count: number };

async function searchCatalogue(
  take: number,
  skip: number,
  options: Partial<CatalogueSearchPayload> = {}
): Promise<CataloguePage> {
  const response = await window.electron.hydraApi.post<CataloguePage>(
    "/catalogue/search",
    {
      data: {
        ...catalogueSearchSlice.getInitialState().filters,
        ...options,
        take,
        skip,
        downloadSourceIds: [],
      },
      needsAuth: false,
    }
  );
  if (
    !Array.isArray(response?.edges) ||
    !Number.isSafeInteger(response.count)
  ) {
    throw new Error("Invalid catalogue response");
  }
  return response;
}

export async function loadCatalogueTopGames() {
  const { edges } = await searchCatalogue(100, 0, {
    sortBy: "popularity",
    sortOrder: "desc",
  });
  return edges.slice(0, 100);
}

const releasePageSize = 24;
const releaseDetailsConcurrency = 6;

export const shiftCatalogueMonth = (month: Date, shift: number) =>
  new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + shift, 1));

async function getCatalogueReleaseDay(
  game: CatalogueSearchResult,
  signal: AbortSignal
) {
  signal.throwIfAborted();
  const path = `/games/${encodeURIComponent(game.shop)}/${encodeURIComponent(game.objectId)}`;
  const response = await window.electron.hydraApi.getResponse<{
    releaseDate?: string | null;
  } | null>(path, { needsAuth: false, acceptedStatuses: [200, 404] });
  const date = response.status === 200 && response.data?.releaseDate;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(date))
    return null;
  const day = date.slice(0, 10);
  const parsed = new Date(day + "T00:00:00.000Z");
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().startsWith(day)
    ? day
    : null;
}

export async function loadCatalogueReleaseMonth(
  month: Date,
  cursor: number | undefined,
  signal: AbortSignal
) {
  const year = month.getUTCFullYear();
  const firstDay = month.toISOString().slice(0, 10);
  const nextMonthDay = shiftCatalogueMonth(month, 1).toISOString().slice(0, 10);
  const options: Partial<CatalogueSearchPayload> = {
    releaseYear: { gte: year, lte: year },
    shops: ["steam", "epic"],
    sortBy: "releaseDate",
    sortOrder: "desc",
  };
  const loadPage = (take: number, skip: number) => {
    signal.throwIfAborted();
    return searchCatalogue(take, skip, options);
  };

  // The API sorts by date but only exposes a year filter. Find the first
  // result earlier than next month by checking dates at offsets in that year.
  const findMonthOffset = async () => {
    const first = await loadPage(5, 0);
    if (!first.edges[0]) return 0;
    const firstRelease = await getCatalogueReleaseDay(first.edges[0], signal);
    if (!firstRelease || firstRelease < nextMonthDay) return 0;

    let low = 1;
    let high = first.count;
    while (low < high) {
      const offset = Math.floor((low + high) / 2);
      const { edges } = await loadPage(5, offset);
      const day = edges[0]
        ? await getCatalogueReleaseDay(edges[0], signal)
        : null;
      if (day && day >= nextMonthDay) low = offset + 1;
      else high = offset;
    }

    return low;
  };

  const offset = cursor ?? (await findMonthOffset());
  const { edges } = await loadPage(releasePageSize + 1, offset);
  const dated: { game: CatalogueSearchResult; day: string | null }[] = [];

  for (
    let index = 0;
    index < edges.length;
    index += releaseDetailsConcurrency
  ) {
    const batch = await Promise.all(
      edges
        .slice(index, index + releaseDetailsConcurrency)
        .map(async (game) => ({
          game,
          day: await getCatalogueReleaseDay(game, signal),
        }))
    );
    dated.push(...batch);
    if (batch.some(({ day }) => day && day < firstDay)) break;
  }

  const games = dated
    .slice(0, releasePageSize)
    .flatMap(({ game, day }) =>
      day && day >= firstDay && day < nextMonthDay ? [{ game, day }] : []
    );
  const extraDay = dated[releasePageSize]?.day;

  return {
    games,
    nextCursor:
      extraDay && extraDay >= firstDay && extraDay < nextMonthDay
        ? offset + releasePageSize
        : null,
  };
}
