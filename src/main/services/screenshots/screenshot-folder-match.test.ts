import assert from "node:assert/strict";
import { test } from "node:test";
import { lookupScreenshotGameDirectory } from "./screenshot-folder-match.js";

test("recognizes exact and legacy hash-suffixed screenshot game directories", () => {
  const games = new Map<string, string | null>([
    ["pionero capital", "game-1"],
    ["call of duty world at war", "game-2"],
    ["ambiguous game", null],
  ]);
  assert.equal(lookupScreenshotGameDirectory("Pionero Capital", games), "game-1");
  assert.equal(lookupScreenshotGameDirectory("Pionero Capital-55d3f410a68d", games), "game-1");
  assert.equal(lookupScreenshotGameDirectory("Call of Duty World at War-abcdef123456", games), "game-2");
  assert.equal(lookupScreenshotGameDirectory("Ambiguous Game-12345678", games), null);
  assert.equal(lookupScreenshotGameDirectory("Pionero Capital-launcher", games), null);
  assert.equal(lookupScreenshotGameDirectory("Not The Game-55d3f410a68d", games), null);
  assert.equal(lookupScreenshotGameDirectory("../Pionero Capital", games), null);
});

test("exact game directory takes priority over a potential hexadecimal suffix", () => {
  const games = new Map<string, string | null>([
    ["game", "original"],
    ["game-12345678", "different"],
  ]);
  assert.equal(lookupScreenshotGameDirectory("game-12345678", games), "different");
});
