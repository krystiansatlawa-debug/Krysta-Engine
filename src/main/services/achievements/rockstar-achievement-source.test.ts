import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchRockstarAchievements, rockstarAchievementTitle, RockstarAchievementSync } from "./rockstar-achievement-source.js";

test("GTA V editions share the same Social Club achievement title", () => {
  assert.equal(rockstarAchievementTitle("gtav-legacy"), "gtav");
  assert.equal(rockstarAchievementTitle("gtav-enhanced"), "gtav");
  assert.equal(rockstarAchievementTitle("rdr2"), "rdr2");
  assert.equal(rockstarAchievementTitle("gtasa"), null);
});

test("Rockstar request uses validated title and account ID and filters progress", async () => {
  const unlocked = await fetchRockstarAchievements("rdr2", "123456", async (url) => {
    const request = new URL(url);
    assert.equal(request.hostname, "scapi.rockstargames.com");
    assert.equal(request.searchParams.get("title"), "rdr2");
    assert.equal(request.searchParams.get("rockstarId"), "123456");
    return { awardedAchievements: {
      first: { achieved: true, dateAchieved: "2026-01-01T12:00:00Z" },
      second: { achieved: false, progress: 80 },
    } };
  });
  assert.deepEqual(unlocked, [{ id: "first", unlockedAt: "2026-01-01T12:00:00.000Z" }]);
});

test("invalid accounts and unavailable titles never invoke the network", async () => {
  let called = false;
  const fetcher = async () => { called = true; return {}; };
  await assert.rejects(fetchRockstarAchievements("gtasa", "123", fetcher));
  await assert.rejects(fetchRockstarAchievements("rdr2", "not-an-id", fetcher));
  assert.equal(called, false);
});

test("failed refresh retains last successful Rockstar snapshot", async () => {
  const sync = new RockstarAchievementSync();
  const first = await sync.sync("rdr2", "123", async () => ({
    awardedAchievements: { won: { achieved: true } },
  }));
  assert.equal(first.items.length, 1);
  await assert.rejects(sync.sync("rdr2", "123", async () => {
    throw new Error("Network unavailable");
  }));
  assert.deepEqual(sync.getCached("rdr2", "123"), first);
  await assert.rejects(sync.sync("rdr2", "123", async () => ({})));
  assert.deepEqual(sync.getCached("rdr2", "123"), first);
  sync.clear();
  assert.equal(sync.getCached("rdr2", "123"), null);
});


test("switching Rockstar accounts never exposes previous account unlocks", async () => {
  const sync = new RockstarAchievementSync();
  await sync.sync("rdr2", "123", async () => ({ awardedAchievements: { one: { achieved: true } } }));
  assert.equal(sync.getCached("rdr2", "456"), null);
  await sync.sync("rdr2", "456", async () => ({ awardedAchievements: { two: { achieved: true } } }));
  assert.equal(sync.getCached("rdr2", "123")?.items[0].id, "one");
  assert.equal(sync.getCached("rdr2", "456")?.items[0].id, "two");
});
