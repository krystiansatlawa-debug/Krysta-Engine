import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchRockstarAchievements, rockstarAchievementTitle } from "./rockstar-achievement-source";

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
