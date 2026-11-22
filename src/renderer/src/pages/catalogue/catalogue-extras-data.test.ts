import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { catalogueSearchSlice } from "../../features/catalogue-search.js";

type Entry = {
  shop: "steam" | "epic";
  objectId: string;
  release?: string;
};

const source = readFileSync(
  new URL("./catalogue-extras-data.ts", import.meta.url),
  "utf8"
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});

function fixture(rows: Entry[]) {
  const pages: {
    take: number;
    skip: number;
    sortBy: string;
    sortOrder: string;
  }[] = [];
  const dates = new Map(rows.map((row) => [row.objectId, row.release]));
  const detailPaths: string[] = [];
  const api = {
    post: async (path: string, { data }: { data: (typeof pages)[number] }) => {
      assert.equal(path, "/catalogue/search");
      pages.push(data);
      return {
        count: rows.length,
        edges: rows.slice(data.skip, data.skip + data.take),
      };
    },
    getResponse: async (path: string) => {
      detailPaths.push(path);
      const releaseDate = dates.get(
        decodeURIComponent(path.split("/").at(-1)!)
      );
      return releaseDate
        ? { status: 200, data: { releaseDate } }
        : { status: 404, data: null };
    },
  };
  const exports = {} as typeof import("./catalogue-extras-data.js");
  new Function("require", "exports", "window", outputText)(
    (path: string) => {
      assert.equal(path, "@renderer/features/catalogue-search");
      return { catalogueSearchSlice };
    },
    exports,
    { electron: { hydraApi: api } }
  );
  return { ...exports, pages, detailPaths };
}

test("Top 100 requests popularity order and keeps ranks in that order", async () => {
  const rows = Array.from({ length: 130 }, (_, index) => ({
    shop: "steam" as const,
    objectId: String(index + 1),
  }));
  const { loadCatalogueTopGames, pages } = fixture(rows);
  const games = await loadCatalogueTopGames();
  assert.equal(pages[0].take, 100);
  assert.equal(pages[0].skip, 0);
  assert.equal(pages[0].sortBy, "popularity");
  assert.equal(pages[0].sortOrder, "desc");
  assert.deepEqual(
    games.map((game) => game.objectId),
    rows.slice(0, 100).map((game) => game.objectId)
  );
});

test("calendar finds the selected month and pages without mixing dates", async () => {
  const rows = [
    {
      shop: "steam" as const,
      objectId: "later",
      release: "2026-12-03T00:00:00.000Z",
    },
    ...Array.from({ length: 28 }, (_, index) => ({
      shop: "steam" as const,
      objectId: String(index + 1),
      release: "2026-11-26",
    })),
    { shop: "steam" as const, objectId: "earlier", release: "2026-10-30" },
    { shop: "epic" as const, objectId: "catalogue:unknown" },
  ];
  const { loadCatalogueReleaseMonth } = fixture(rows);
  const date = new Date("2026-11-01T00:00:00.000Z");
  const signal = new AbortController().signal;
  const first = await loadCatalogueReleaseMonth(date, undefined, signal);
  assert.equal(first.games.length, 24);
  assert.equal(first.games[0].game.objectId, "1");
  assert.equal(first.games[0].day, "2026-11-26");
  assert.equal(first.nextCursor, 25);
  const second = await loadCatalogueReleaseMonth(
    date,
    first.nextCursor!,
    signal
  );
  assert.deepEqual(
    second.games.map(({ game }) => game.objectId),
    ["25", "26", "27", "28"]
  );
  assert.equal(second.nextCursor, null);
});

test("calendar omits missing and invalid dates and encodes store identifiers", async () => {
  const { loadCatalogueReleaseMonth, detailPaths } = fixture([
    { shop: "epic", objectId: "ns:valid", release: "2026-02-28T00:00:00.000Z" },
    { shop: "steam", objectId: "invalid", release: "2026-02-30" },
    { shop: "steam", objectId: "unscheduled" },
  ]);
  const result = await loadCatalogueReleaseMonth(
    new Date("2026-02-01T00:00:00.000Z"),
    undefined,
    new AbortController().signal
  );
  assert.deepEqual(
    result.games.map(({ day }) => day),
    ["2026-02-28"]
  );
  assert.ok(detailPaths.includes("/games/epic/ns%3Avalid"));
});

test("month navigation crosses December and stops cancelled requests", async () => {
  const { shiftCatalogueMonth, loadCatalogueReleaseMonth, pages } = fixture([]);
  const january = shiftCatalogueMonth(new Date("2026-12-01T00:00:00Z"), 1);
  assert.equal(january.toISOString(), "2027-01-01T00:00:00.000Z");
  await assert.rejects(
    loadCatalogueReleaseMonth(january, undefined, AbortSignal.abort()),
    { name: "AbortError" }
  );
  assert.equal(pages.length, 0);
});
