import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchRockstarAwardedAchievements } from "./rockstar-achievement-client.js";

test("reads only verified Rockstar unlocks through first-party HTTPS endpoint", async () => {
  let requested = "";
  const mock = (async (url: URL | RequestInfo, init?: RequestInit) => {
    requested = String(url);
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer test-token");
    return new Response(JSON.stringify({
      awardedAchievements: {
        "1": { achieved: true, dateAchieved: "2026-11-20T12:00:00Z" },
        "2": { achieved: false, dateAchieved: "2026-11-20T13:00:00Z" },
      },
    }), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const awards = await fetchRockstarAwardedAchievements(
    "gtav-enhanced", "1234567", "test-token", mock
  );
  assert.equal(new URL(requested).hostname, "scapi.rockstargames.com");
  assert.equal(new URL(requested).searchParams.get("title"), "gtav");
  assert.equal(new URL(requested).searchParams.get("rockstarId"), "1234567");
  assert.deepEqual(awards.map((row) => row.id), ["1"]);
});

test("rejects invalid account identifiers, tokens and denied access", async () => {
  await assert.rejects(fetchRockstarAwardedAchievements(
    "rdr2", "../other", "token"
  ), /Invalid Rockstar account/);
  await assert.rejects(fetchRockstarAwardedAchievements(
    "rdr2", "123", "x\nInjected"
  ), /Invalid Rockstar authentication/);
  const forbidden = (async () => new Response(null, { status: 401 })) as typeof fetch;
  await assert.rejects(fetchRockstarAwardedAchievements(
    "rdr2", "123", "test-token", forbidden
  ), /expired or access denied/);
});
