import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRockstarUnlockedAchievements } from "./rockstar-achievement-parser";

test("only explicitly achieved Rockstar entries are unlocked", () => {
  assert.deepEqual(parseRockstarUnlockedAchievements({
    awardedAchievements: {
      complete: { achieved: true, awardedAt: "2026-01-01T12:00:00Z" },
      progress: { achieved: false, progress: 75 },
    },
  }), [{ id: "complete", unlockedAt: "2026-01-01T12:00:00.000Z" }]);
});

test("incomplete and invalid responses cannot silently reset achievements", () => {
  for (const payload of [
    null,
    {},
    { awardedAchievements: [] },
    { awardedAchievements: { unknown: { progress: 50 } } },
    { awardedAchievements: { invalid: null } },
  ]) assert.throws(() => parseRockstarUnlockedAchievements(payload));
});

test("confirmed empty set is valid", () => {
  assert.deepEqual(parseRockstarUnlockedAchievements({ awardedAchievements: {} }), []);
});
