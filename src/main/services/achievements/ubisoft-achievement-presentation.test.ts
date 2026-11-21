import assert from "node:assert/strict";
import { test } from "node:test";
import { presentUbisoftAchievements } from "./ubisoft-achievement-presentation.js";

test("projects Ubisoft trophy unlocks into the normal achievements view", () => {
  const output = presentUbisoftAchievements([
    {
      id: "7013-1",
      title: "The beginning",
      description: "Finish the prologue",
      icon: "https://ubiservices.cdn.ubi.com/trophy.png",
      unlocked: true,
      completionDate: "2026-11-20T12:00:00Z",
    },
    {
      id: "7013-2",
      title: "Unknown future challenge",
      description: "",
      icon: null,
      unlocked: false,
      completionDate: null,
    },
  ]);
  assert.equal(output.length, 2);
  assert.equal(output[0].name, "ubisoft:7013-1");
  assert.equal(output[0].unlocked, true);
  assert.equal(output[0].unlockTime, Date.parse("2026-11-20T12:00:00Z"));
  assert.equal(output[0].displayName, "The beginning");
  assert.equal(output[1].name, "ubisoft:7013-2");
  assert.equal(output[1].unlocked, false);
  assert.equal(output[1].unlockTime, null);
  assert.equal(output[1].icon, "");
});

test("keeps a confirmed unlock without inventing a completion date", () => {
  const output = presentUbisoftAchievements([
    {
      id: "7013-9",
      title: "An old unlock",
      description: "",
      icon: null,
      unlocked: true,
      completionDate: null,
    },
  ]);
  assert.equal(output[0].unlocked, true);
  assert.equal(output[0].unlockTime, null);
});

test("does not confuse the same achievement name with Steam's identifier", () => {
  const output = presentUbisoftAchievements([
    {
      id: "7321-4",
      title: "FIRST",
      description: "",
      icon: null,
      unlocked: true,
      completionDate: null,
    },
  ]);
  assert.equal(output[0].name, "ubisoft:7321-4");
  assert.equal(output[0].displayName, "FIRST");
});
