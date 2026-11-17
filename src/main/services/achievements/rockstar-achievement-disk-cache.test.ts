import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { RockstarAchievementDiskCache } from "./rockstar-achievement-disk-cache.js";

test("Rockstar snapshots survive restart and never leak to another account", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "krysta-rockstar-"));
  try {
    const file = path.join(dir, "rockstar-achievements.json");
    const first = new RockstarAchievementDiskCache(file);
    const snapshot = { updatedAt: "2026-01-01T12:00:00Z",
      items: [{ id: "A1", unlockedAt: "2026-01-01T12:00:00Z" }] };
    await first.save("123", "rdr2", snapshot);
    const restarted = new RockstarAchievementDiskCache(file);
    assert.deepEqual(await restarted.read("123", "rdr2"), snapshot);
    assert.equal(await restarted.read("456", "rdr2"), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("malformed cache is treated as unavailable, not a valid empty sync", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "krysta-rockstar-"));
  try {
    const cache = new RockstarAchievementDiskCache(path.join(dir, "cache.json"));
    assert.equal(await cache.read("123", "rdr2"), null);
    await assert.rejects(cache.save("invalid-id", "rdr2", { items: [], updatedAt: new Date().toISOString() }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
