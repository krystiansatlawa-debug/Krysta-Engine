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
