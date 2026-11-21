import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ClassicLevel } from "classic-level";

import { createGameJournalStore } from "./game-journal-store.js";

test("persists complete sessions and merges only the selected game identities", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "krysta-journal-"));
  const db = new ClassicLevel(directory);
  t.after(async () => {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  });
  const journal = createGameJournalStore(db);
  assert.deepEqual(await journal.read(["steam:1"], 2), {
    sessions: [],
    hasMore: false,
  });

  await Promise.all([
    journal.record("steam:1", 1000, 2000),
    journal.record("steam:1", 3000, 5000),
    journal.record("epic:game", 2000, 2500),
    journal.record("steam:10", 4000, 5000),
    journal.record("steam:1:other", 4000, 5000),
  ]);
  // A session can finish while the launcher is quitting.
  await journal.record("steam:1", 3000, 6000);

  await db.close();
  await db.open();
  const firstPage = await journal.read(["steam:1", "epic:game"], 2);
  assert.equal(firstPage.hasMore, true);
  assert.deepEqual(
    firstPage.sessions.map(({ startedAt, endedAt }) => endedAt - startedAt),
    [3000, 500]
  );
  const all = await journal.read(["steam:1", "epic:game"], 4);
  assert.equal(all.hasMore, false);
  assert.deepEqual(
    all.sessions.map(({ startedAt, endedAt }) => endedAt - startedAt),
    [3000, 500, 1000]
  );
});
