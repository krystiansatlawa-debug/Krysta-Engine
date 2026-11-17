import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isUbisoftLibraryGame,
  toHydraUbisoftAchievements,
} from "./ubisoft-achievements.js";

describe("Ubisoft achievements in native Hydra view", () => {
  it("recognizes only Ubisoft-specific custom game identifiers", () => {
    assert.equal(isUbisoftLibraryGame("custom", "ubisoft-12345"), true);
    assert.equal(isUbisoftLibraryGame("custom", "ubi-owned-" + "a".repeat(32)), true);
    assert.equal(isUbisoftLibraryGame("steam", "ubisoft-12345"), false);
    assert.equal(isUbisoftLibraryGame("custom", "ordinary-custom-game"), false);
  });

  it("adapts verified unlocks without marking Steam or Hydra achievements", () => {
    const achievements = toHydraUbisoftAchievements([
      {
        id: "ubi-a",
        title: "Ubisoft trophy",
        description: "Complete the mission",
        icon: "https://ubiservices.cdn.ubi.com/trophy.png",
        unlocked: true,
        completionDate: "2026-11-17T14:00:00.000Z",
      },
      {
        id: "ubi-b",
        title: "Not yet",
        description: "Finish the challenge",
        icon: null,
        unlocked: false,
        completionDate: null,
      },
    ]);
    assert.equal(achievements.length, 2);
    assert.equal(achievements[0].name, "ubisoft:ubi-a");
    assert.equal(achievements[0].unlocked, true);
    assert.equal(achievements[0].unlockTime, Date.parse("2026-11-17T14:00:00.000Z"));
    assert.equal(achievements[0].source, undefined);
    assert.equal(achievements[0].unlockedOn, undefined);
    assert.equal(achievements[1].unlocked, false);
    assert.equal(achievements[1].unlockTime, null);
    assert.ok(achievements[1].icon.startsWith("data:image/svg+xml,"));
  });

  it("does not manufacture unlock dates when source date is absent or invalid", () => {
    for (const value of [null, "not-a-date"]) {
      const [entry] = toHydraUbisoftAchievements([
        { id: "x", title: "x", description: "", icon: null, unlocked: true, completionDate: value },
      ]);
      assert.equal(entry.unlockTime, null);
    }
  });
});
