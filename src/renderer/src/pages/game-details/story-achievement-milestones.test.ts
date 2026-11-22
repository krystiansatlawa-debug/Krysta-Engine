import assert from "node:assert/strict";
import test from "node:test";
import type { UserAchievement } from "@types";
import { getStoryAchievementMilestone } from "./story-achievement-milestones.js";

const achievement = (
  name: string,
  values: Partial<UserAchievement> = {}
): UserAchievement => ({
  name,
  displayName: name,
  icon: "",
  icongray: "",
  hidden: false,
  unlocked: true,
  unlockTime: 1000,
  ...values,
});

test("uses Steam's stable IDs to find the furthest unlocked base campaign sequence", () => {
  const actual = getStoryAchievementMilestone(
    { shop: "steam", objectId: "289650", title: "Assassin’s Creed Unity" },
    [
      achievement("ACU_Ach_7", { displayName: "Sekretne spotkanie" }),
      achievement("ACU_Ach_13", { unlocked: false }),
      achievement("ACU_Ach_52", { unlockTime: 4000 }), // Dead Kings
      achievement("ACU_Ach_4", { unlockTime: 3000 }), // Replayed earlier sequence
    ]
  );
  assert.deepEqual(actual, {
    title: "Sekretne spotkanie",
    chapter: 6,
    totalChapters: 12,
    finale: false,
  });
});

test("resolves Ubisoft account milestones with opaque IDs and scoped descriptions", () => {
  const valhalla = {
    shop: "custom" as const,
    objectId: "ubisoft-7013",
    title: "Assassin’s Creed® Valhalla",
  };
  assert.equal(
    getStoryAchievementMilestone(valhalla, [
      achievement("ubisoft:1148", { displayName: "To England!" }),
      achievement("ubisoft:1182", { displayName: "Rampage", unlockTime: 2000 }),
    ])?.title,
    "To England!"
  );
  assert.equal(
    getStoryAchievementMilestone(
      {
        ...valhalla,
        catalogueGame: { shop: "steam", objectId: "289650" },
        title: "Unity",
      },
      [
        achievement("ubisoft:100", {
          description: "Complete Memory Sequence 7.",
        }),
        achievement("ubisoft:555", {
          description: "Complete Memory Sequence 13.",
        }),
      ]
    )?.chapter,
    7
  );
});

test("requires an exact game match and rejects online, side, locked and DLC unlocks", () => {
  const game = { shop: "steam" as const, objectId: "271590", title: "GTA V" };
  assert.equal(
    getStoryAchievementMilestone(game, [
      achievement("ACH30"), // GTA Online intro
      achievement("ACH04", { unlocked: false }),
      achievement("ACH21"), // Side activity
    ]),
    null
  );
  assert.equal(
    getStoryAchievementMilestone({ ...game, objectId: "123" }, [
      achievement("ACH04"),
    ]),
    null
  );
  assert.equal(
    getStoryAchievementMilestone(game, [
      achievement("ACH04", { unlockTime: 10 }),
      achievement("ACH05", { unlockTime: 100 }),
    ])?.finale,
    true
  );
});

test("uses the identity of a linked Steam unlock while keeping the displayed title", () => {
  const game = {
    shop: "epic" as const,
    objectId: "arkham",
    catalogueGame: { shop: "steam" as const, objectId: "209000" },
    title: "Batman Arkham Origins",
  };
  assert.equal(
    getStoryAchievementMilestone(game, [
      achievement("canonical:200", {
        displayName: "Jedno oko otwarte",
        sources: [
          {
            shop: "steam",
            objectId: "209000",
            name: "Achievement_2",
            unlockTime: 1000,
          },
        ],
      }),
      achievement("canonical:201", {
        sources: [
          {
            shop: "steam",
            objectId: "208650",
            name: "Achievement_6",
            unlockTime: 2000,
          },
        ],
      }),
    ])?.title,
    "Jedno oko otwarte"
  );
});

test("picks the verified Far Cry 4 story milestone from Ubisoft without using side unlocks", () => {
  assert.equal(
    getStoryAchievementMilestone(
      { shop: "custom", objectId: "ubisoft-420", title: "Far Cry® 4" },
      [
        achievement("ubisoft:203", { displayName: "One Down" }),
        achievement("ubisoft:299", {
          displayName: "Deliver Us From Evil",
          unlockTime: 2000,
        }),
        achievement("ubisoft:324", {
          displayName: "Rewriting History",
          unlockTime: 3000,
        }),
      ]
    )?.title,
    "One Down"
  );
});
