import assert from "node:assert/strict";
import { test } from "node:test";

import { createStoryProgressCardRegistry } from "./story-progress-card-registry.js";

test("shows only one card for a game, even when several views mount", () => {
  const registry = createStoryProgressCardRegistry();
  let first = false;
  let second = false;
  let third = false;

  const stopFirst = registry.register("steam:271590", (primary) => {
    first = primary;
  });
  const stopSecond = registry.register("steam:271590", (primary) => {
    second = primary;
  });
  const stopThird = registry.register("steam:271590", (primary) => {
    third = primary;
  });

  assert.deepEqual([first, second, third], [true, false, false]);
  stopSecond();
  assert.deepEqual([first, third], [true, false]);

  stopFirst();
  assert.equal(third, true);
  stopFirst(); // Unsubscribing twice must not hide the remaining card.
  assert.equal(third, true);
  stopThird();
});

test("allows one visible card for each different game", () => {
  const registry = createStoryProgressCardRegistry();
  let gta = false;
  let rdr = false;
  const stopGta = registry.register("steam:271590", (primary) => {
    gta = primary;
  });
  const stopRdr = registry.register("steam:1174180", (primary) => {
    rdr = primary;
  });

  assert.equal(gta, true);
  assert.equal(rdr, true);
  stopGta();
  stopRdr();
});

test("lets the next mounted card take ownership when the first closes", () => {
  const registry = createStoryProgressCardRegistry();
  let oldCard = false;
  let newCard = false;
  const stopOld = registry.register("custom:game", (primary) => {
    oldCard = primary;
  });
  const stopNew = registry.register("custom:game", (primary) => {
    newCard = primary;
  });

  assert.equal(oldCard, true);
  assert.equal(newCard, false);
  stopOld();
  assert.equal(newCard, true);
  stopNew();
});
