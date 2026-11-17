import assert from "node:assert/strict";
import { test } from "node:test";
import { needsAutomaticGameUpdateRefresh as refresh } from "./game-update-refresh-policy.js";

test("game details uses recent saved provider status instead of refetching on every visit", () => {
  const now = Date.parse("2026-11-17T17:00:00Z");
  assert.equal(refresh(null, now), true);
  assert.equal(refresh({lastChecked:null,updateCheckedAt:null},now),true);
  assert.equal(refresh({updateCheckedAt:"2026-11-17T16:58:00Z",updateState:"required"},now),false);
  assert.equal(refresh({lastChecked:"2026-11-17T16:59:00Z",updateCheckedAt:"2026-11-17T15:00:00Z"},now),false);
  assert.equal(refresh({updateCheckedAt:"2026-11-17T16:54:00Z"},now),true);
  assert.equal(refresh({lastChecked:"2026-11-17T16:59:00Z",updateCheckedAt:"2026-11-17T15:00:00Z",updateState:"required"},now),true);
  assert.equal(refresh({lastChecked:"bad-date",updateCheckedAt:null},now),true);
  assert.equal(refresh({lastChecked:"2026-11-18T00:00:00Z"},now),true);
});
