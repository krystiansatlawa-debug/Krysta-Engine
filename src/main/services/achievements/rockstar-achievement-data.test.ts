import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseRockstarAwardedAchievements,
  presentRockstarAwards,
} from "./rockstar-achievement-data.js";

test("Rockstar partial progress never becomes an unlocked achievement", () => {
  const awards = parseRockstarAwardedAchievements({
    awardedAchievements: {
      "1": { achieved: false, dateAchieved: "2026-11-20T10:00:00Z", progress: 80 },
      "2": { achieved: true, dateAchieved: "2026-11-21T10:00:00Z" },
      "3": { dateAchieved: "2026-11-22T10:00:00Z" },
      "4": { achieved: true, dateAchieved: null },
      "5": { achieved: true, dateAchieved: "not a date" },
    },
  });
  assert.deepEqual(awards.map((award) => award.id), ["3", "2"]);
  assert.equal(awards[0]?.unlockTime, Date.parse("2026-11-22T10:00:00Z"));
});

test("Rockstar source stays read-only and distinct from Steam unlock state", () => {
  const awards = parseRockstarAwardedAchievements({
    awardedAchievements: {
      "10": { achieved: true, dateAchieved: "2026-11-21T12:00:00Z" },
    },
  });
  const displayed = presentRockstarAwards([
    { id: "10", title: "Unlocked Rockstar" },
    { id: "11", title: "Still locked" },
  ], awards);
  assert.equal(displayed[0]?.name, "rockstar:10");
  assert.equal(displayed[0]?.unlocked, true);
  assert.equal(displayed[1]?.unlocked, false);
  assert.equal(displayed[1]?.unlockTime, null);
});

test("reject missing data, arrays and excessive entries", () => {
  assert.throws(() => parseRockstarAwardedAchievements({}), /missing/);
  assert.throws(() => parseRockstarAwardedAchievements([]), /Invalid/);
  const many = Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [
    String(i), { achieved: true, dateAchieved: "2026-01-01T00:00:00Z" },
  ]));
  assert.throws(() => parseRockstarAwardedAchievements({
    awardedAchievements: many,
  }), /safe limit/);
});
