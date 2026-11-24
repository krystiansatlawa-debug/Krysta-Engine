import { test } from "node:test";
import assert from "node:assert/strict";
import { selectFeatured } from "./featured-selection.js";

const game = (objectId: string, shop = "steam") => ({ objectId, shop, title: objectId, libraryImageUrl: "https://example.com/cover" });
test("prioritizes unowned games and preserves editorial order", () => {
  assert.deepEqual(selectFeatured([game("1"), game("2")], [game("3")], new Set(["steam:1"])).map(g => g.objectId), ["2", "3", "1"]);
});
test("deduplicates by shop and id, rejects missing art and respects limit", () => {
  assert.deepEqual(selectFeatured([game("1"), {...game("2"), libraryImageUrl: ""}], [game("1"), game("1", "epic"), game("3")], new Set(), 2).map(g => g.shop), ["steam", "epic"]);
});
test("handles empty catalogue", () => assert.deepEqual(selectFeatured([], [], new Set()), []));
