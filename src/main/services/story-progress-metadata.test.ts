import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";

import {
  discoverSelectedStorySaveFiles,
  parseGenericStoryMetadata,
  readGenericStoryMetadataFiles,
} from "./story-progress-metadata.js";
import { readDiscoveredStorySave } from "./story-progress-save.js";

test("reads explicitly labelled campaign completion and current mission from JSON", () => {
  assert.deepEqual(
    parseGenericStoryMetadata(
      JSON.stringify({
        SaveGame: {
          MainStory: {
            Percent: 42.5,
            currentMissionName: "Find the transmitter",
            missionDescription: "Reach the outpost and restore its signal.",
          },
          stats: { achievementProgress: 99 },
        },
      })
    ),
    {
      percent: 42.5,
      saveTitle: "Find the transmitter",
      progressKind: "story",
      missionDescription: "Reach the outpost and restore its signal.",
    }
  );
});

test("reads explicit campaign progress from INI and XML", () => {
  assert.deepEqual(
    parseGenericStoryMetadata(
      "[Campaign]\npercent=18.5\ncurrentQuest=Find shelter",
      "ini"
    ),
    { percent: 18.5, saveTitle: "Find shelter", progressKind: "story" }
  );
  assert.deepEqual(
    parseGenericStoryMetadata(
      "<data><storyProgressPercent>67</storyProgressPercent><currentMission>Return home</currentMission></data>",
      "xml"
    ),
    { percent: 67, saveTitle: "Return home", progressKind: "story" }
  );
});

test("does not invent story progress from statistics, achievements, time or loose percentages", () => {
  for (const data of [
    { playtime: 200, percent: 80, achievementProgress: 100 },
    { skills: { storyProgressPercent: 100 } },
    { inventory: { currentMission: "Sword" } },
    { campaign: { percent: 102 } },
    { story: { percent: true } },
    { story: { percent: "unknown" } },
  ]) {
    assert.equal(parseGenericStoryMetadata(JSON.stringify(data)), null);
  }
  assert.equal(parseGenericStoryMetadata("{broken"), null);
});

test("extracts a tracked mission without inventing a percentage", () => {
  assert.deepEqual(
    parseGenericStoryMetadata('{"metadata":{"trackedQuest":"Escape"}}'),
    {
      percent: null,
      saveTitle: "Escape",
    }
  );
});

test("reads text metadata from detected saves and preserves real timestamps", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "krysta-story-generic-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const oldFile = path.join(dir, "old.sav");
  const metadata = path.join(dir, "slot.json");
  await writeFile(oldFile, "unrecognized save bytes");
  await writeFile(
    metadata,
    JSON.stringify({
      campaignProgressPercent: 73,
      currentMission: "Final chapter",
    })
  );
  const mtime = new Date("2026-11-21T09:10:00Z");
  await utimes(metadata, mtime, mtime);

  assert.deepEqual(
    await readDiscoveredStorySave([oldFile, metadata], undefined, () => true),
    {
      status: "ready",
      automatic: {
        percent: 73,
        saveTitle: "Final chapter",
        progressKind: "story",
        savedAt: mtime.getTime(),
      },
    }
  );
});

test("finds game saves in selected folders without following symbolic links", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "krysta-selected-save-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const campaign = path.join(root, "campaign", "slot1");
  await mkdir(campaign, { recursive: true });
  const metadata = path.join(campaign, "progress.json");
  await writeFile(
    metadata,
    JSON.stringify({ storyCompletionPercent: 25, currentQuest: "Reunion" })
  );
  await writeFile(path.join(root, "readme.txt"), "ignore");
  try {
    await symlink(metadata, path.join(root, "linked.json"));
  } catch {
    // Windows may require extra privileges to create symbolic links.
  }
  const files = await discoverSelectedStorySaveFiles(root, () => true);
  assert.deepEqual(files, [metadata]);
  const current = await readGenericStoryMetadataFiles(files, () => true);
  assert.equal(current?.percent, 25);
  assert.equal(current?.progressKind, "story");
});

test("reads scoped XML campaign fields and ignores unrelated nodes", () => {
  assert.deepEqual(
    parseGenericStoryMetadata(
      "<save><settings><currentQuest>Ignore this</currentQuest></settings><campaign><percent>67</percent><currentChapter>Fire &amp; Ice</currentChapter></campaign></save>",
      "xml"
    ),
    {
      percent: 67,
      saveTitle: "Fire & Ice",
      saveTitleKind: "chapter",
      progressKind: "story",
    }
  );
  assert.equal(
    parseGenericStoryMetadata(
      "<save><stats><percent>97</percent></stats></save>",
      "xml"
    ),
    null
  );
  assert.equal(
    parseGenericStoryMetadata(
      "<!DOCTYPE save><save><storyProgress>67</storyProgress></save>",
      "xml"
    ),
    null
  );
  assert.equal(
    parseGenericStoryMetadata(
      "<save><campaign><percent>67</percent></save>",
      "xml"
    ),
    null
  );
});

test("detects gzip and UTF-16 story metadata in save slots by their contents", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "krysta-story-encoded-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const compressed = path.join(root, "slot.save");
  const utf16 = path.join(root, "checkpoint.dat");
  const oversized = path.join(root, "oversized.sav");
  await writeFile(
    compressed,
    gzipSync('{"campaign":{"currentChapter":"Rozdział drugi"}}')
  );
  await writeFile(
    utf16,
    Buffer.from('\ufeff{"campaignProgressPercent":42}', "utf16le")
  );
  await writeFile(oversized, gzipSync(Buffer.alloc(1024 * 1024, 65)));
  const files = await discoverSelectedStorySaveFiles(root, () => true);
  assert.deepEqual(files.sort(), [utf16, oversized, compressed]);
  const chapter = await readDiscoveredStorySave(
    [compressed],
    undefined,
    () => true
  );
  assert.equal(chapter.automatic?.saveTitle, "Rozdział drugi");
  assert.equal(chapter.automatic?.percent, null);
  assert.equal(chapter.automatic?.saveTitleKind, "chapter");
  assert.equal(
    (await readGenericStoryMetadataFiles([utf16], () => true))?.percent,
    42
  );
  assert.equal(
    await readGenericStoryMetadataFiles([oversized], () => true),
    null
  );
});

test("reports explicit mission counts and nested mission details across save formats", () => {
  assert.deepEqual(
    parseGenericStoryMetadata(
      JSON.stringify({
        campaign: {
          completedQuests: ["intro", "rescue", "intro"],
          totalQuests: 9,
          trackedQuest: { title: "Find shelter", summary: "Reach the ridge." },
        },
        achievements: { completedStoryMissions: 50 },
      })
    ),
    {
      percent: null,
      saveTitle: "Find shelter",
      missionDescription: "Reach the ridge.",
      completedMissions: 2,
      totalMissions: 9,
    }
  );
  assert.deepEqual(
    parseGenericStoryMetadata(
      '<save><campaign completedMissions="0" totalMissions="12"><currentQuest name="Prologue"/></campaign></save>',
      "xml"
    ),
    {
      percent: null,
      saveTitle: "Prologue",
      completedMissions: 0,
      totalMissions: 12,
    }
  );
  assert.deepEqual(
    parseGenericStoryMetadata(
      "[Campaign]\ncompletedMissions=3\ntotalMissions=2",
      "ini"
    ),
    { percent: null, saveTitle: "", completedMissions: 3 }
  );
  assert.equal(
    parseGenericStoryMetadata(
      '{"sideQuests":{"completedStoryMissions":15},"completedMissions":57}'
    ),
    null
  );
});


test("reads explicit main mission completion lists without counting side quests", () => {
  const result = parseGenericStoryMetadata(JSON.stringify({ campaign: { mainMissions: [{ id: "a", completed: true }, { id: "b", completed: false }], sideQuests: [{ id: "c", completed: true }] } }));
  assert.equal(result?.completedMissions, 1);
  assert.equal(result?.totalMissions, 2);
});
