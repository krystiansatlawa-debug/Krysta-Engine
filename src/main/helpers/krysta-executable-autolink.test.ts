import { test } from "node:test";
import assert from "node:assert/strict";
import { canAutoLinkKrystaExecutable as allows } from "./krysta-executable-autolink.js";
const game = {
  isDeleted: false,
  source: "hydra" as const,
  hasActiveSteamImport: false,
  hasActiveEpicImport: false,
  executablePath: null,
};
test("games added to Krysta without a launch executable may be auto-linked", () =>
  assert.equal(allows(game), true));
test("manual settings and previous automatic matches are never replaced", () =>
  assert.equal(
    allows({ ...game, executablePath: "C:\\Games\\Game\\Game.exe" }),
    false
  ));
test("official game imports are left with their existing launch client", () => {
  assert.equal(allows({ ...game, source: "steam" }), false);
  assert.equal(allows({ ...game, source: "epic" }), false);
  assert.equal(allows({ ...game, hasActiveSteamImport: true }), false);
  assert.equal(allows({ ...game, hasActiveEpicImport: true }), false);
});
test("deleted and unknown game records are skipped", () => {
  assert.equal(allows({ ...game, isDeleted: true }), false);
  assert.equal(allows(null), false);
});
