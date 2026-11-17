import assert from "node:assert/strict";
import { test } from "node:test";
import { presentRockstarInHydra } from "./rockstar-hydra-presentation.js";

test("Rockstar unlocks appear in Hydra's existing achievement model", () => {
  const definitions = [
    { name: "ACH_1", displayName: "First trophy", icon: "icon", icongray: "gray", hidden: false },
    { name: "ACH_2", displayName: "Second trophy", icon: "icon2", icongray: "gray2", hidden: false },
  ];
  const result = presentRockstarInHydra(definitions, [
    { id: "ach_1", unlockedAt: "2026-01-01T12:00:00Z" },
    { id: "UNKNOWN", unlockedAt: "2026-01-01T12:00:00Z" },
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].unlocked, true);
  assert.equal(result[0].unlockTime, 1767268800);
  assert.equal(result[1].unlocked, false);
  assert.equal(result[1].unlockTime, null);
  assert.equal(result[0].displayName, "First trophy");
});

test("no unlock is invented for missing dates", () => {
  const result = presentRockstarInHydra(
    [{ name: "ACH_1", displayName: "One", icon: "", icongray: "", hidden: false }],
    [{ id: "ACH_1", unlockedAt: null }]
  );
  assert.equal(result[0].unlocked, false);
});
