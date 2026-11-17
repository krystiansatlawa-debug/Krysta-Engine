import assert from "node:assert/strict";
import { test } from "node:test";
import { toHydraRockstarUnlocks } from "./rockstar-hydra-adapter";

test("Rockstar unlocks use Hydra's internal timestamp format", () => {
  assert.deepEqual(toHydraRockstarUnlocks([
    { id: "ACH_FIRST", unlockedAt: "2026-01-01T12:00:00.000Z" },
  ]), [{ name: "ACH_FIRST", unlockTime: 1767268800 }]);
});

test("unknown dates are not fabricated and duplicates are merged", () => {
  assert.deepEqual(toHydraRockstarUnlocks([
    { id: "ACH_FIRST", unlockedAt: null },
    { id: "ach_second", unlockedAt: "2026-01-02T12:00:00.000Z" },
    { id: "ACH_SECOND", unlockedAt: "2026-01-01T12:00:00.000Z" },
  ]), [{ name: "ACH_SECOND", unlockTime: 1767268800 }]);
});
