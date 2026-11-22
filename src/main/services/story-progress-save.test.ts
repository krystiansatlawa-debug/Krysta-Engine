import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  identifyStorySaveSource,
  parseCyberpunkStoryMetadata,
  parseGtaIvStoryHeader,
  parseRockstarStoryHeader,
  readLatestStorySave,
  readDiscoveredStorySave,
} from "./story-progress-save.js";

const rockstarSave = (version: number, title: string) => {
  const bytes = Buffer.alloc(288);
  bytes.writeUInt32BE(version);
  bytes.write(title, 4, 256, "utf16le");
  return bytes;
};

test("reads Rockstar completion only from the expected PC save header", () => {
  const save = rockstarSave(
    4,
    "(Autosave) A new trail (42,25%) - 11/21/26 10:25:00"
  );
  assert.deepEqual(parseRockstarStoryHeader(save, "rdr2"), {
    percent: 42.25,
    saveTitle: "A new trail",
    summaryKey: undefined,
  });
  assert.equal(parseRockstarStoryHeader(save, "gtav"), null);
  assert.equal(parseRockstarStoryHeader(save.subarray(0, 120), "rdr2"), null);
  assert.equal(
    parseRockstarStoryHeader(
      rockstarSave(1, "A new trail (101%) - 11/21/26 10:25"),
      "gtav"
    ),
    null
  );
});

test("recognizes official IDs, linked executables, and exact Epic or custom titles", () => {
  assert.equal(
    identifyStorySaveSource({ shop: "steam", objectId: "3240220" }),
    "gtav-enhanced"
  );
  assert.equal(
    identifyStorySaveSource({
      shop: "custom",
      objectId: "g",
      executablePath: "C:\\Games\\bin\\Cyberpunk2077.exe",
    }),
    "cyberpunk"
  );
  assert.equal(
    identifyStorySaveSource({ shop: "steam", objectId: "1" }),
    undefined
  );
  assert.equal(
    identifyStorySaveSource({
      shop: "epic",
      objectId: "g",
      title: "Grand Theft Auto V - Enhanced",
    }),
    "gtav-enhanced"
  );
  assert.equal(
    identifyStorySaveSource({ shop: "custom", objectId: "g", title: "RDR2" }),
    "rdr2"
  );
  assert.equal(
    identifyStorySaveSource({
      shop: "custom",
      objectId: "g",
      title: "RDR2 Online tools",
    }),
    undefined
  );
});

test("preserves an unknown Cyberpunk quest identifier and never treats it as a completion percentage", () => {
  const json = JSON.stringify({
    Data: {
      metadata: {
        trackedQuest: "LocKey#123",
        trackedQuestEntry: "quests/main_quest/q119_test/mission",
      },
    },
  });
  assert.deepEqual(parseCyberpunkStoryMetadata(json), {
    percent: null,
    saveTitle: "",
    trackedQuestId: "q119_test",
  });
  assert.deepEqual(
    parseCyberpunkStoryMetadata(
      '{"Data":{"metadata":{"trackedQuest":"LocKey#1"}}}'
    ),
    { percent: null, saveTitle: "", trackedQuestId: "LocKey#1" }
  );
  assert.equal(parseCyberpunkStoryMetadata("{broken JSON"), null);
});

test("uses the latest Cyberpunk slot containing a save and its highest metadata version", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "krysta-cyber-save-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(
    root,
    "Saved Games",
    "CD Projekt Red",
    "Cyberpunk 2077"
  );
  const slot = path.join(directory, "AutoSave-1");
  await mkdir(slot, { recursive: true });
  await mkdir(path.join(directory, "AutoSave-2"));
  await writeFile(path.join(slot, "sav.dat"), "synthetic save stub");
  await writeFile(
    path.join(slot, "metadata.9.json"),
    '{"Data":{"metadata":{"trackedQuest":"Old metadata"}}}'
  );
  await writeFile(
    path.join(slot, "metadata.10.json"),
    '{"Data":{"metadata":{"trackedQuest":"Newest metadata"}}}'
  );
  const snapshot = await readLatestStorySave(
    "cyberpunk",
    { profiles: [{ home: root, documents: root }] },
    () => true
  );
  assert.equal(snapshot.automatic?.saveTitle, "Newest metadata");
  assert.equal(snapshot.automatic.percent, null);
});

test("selects the newest actual slot in each edition and stops when gameplay interrupts the scan", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "krysta-story-save-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = { profiles: [{ documents: root, home: root }] };
  const legacy = path.join(
    root,
    "Rockstar Games",
    "GTA V",
    "Profiles",
    "first"
  );
  const enhanced = path.join(
    root,
    "Rockstar Games",
    "GTAV Enhanced",
    "Profiles",
    "second"
  );
  const timestamp = new Date("2026-11-21T09:00:00Z");
  const newer = new Date(timestamp.getTime() + 1000);
  const makeSlot = async (
    directory: string,
    filename: string,
    title: string,
    time: Date
  ) => {
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, filename);
    await writeFile(file, rockstarSave(1, title + " (7.5%) - 11/21/26 10:25"));
    await utimes(file, time, time);
  };
  await makeSlot(legacy, "SGTA50000", "Old save", timestamp);
  await makeSlot(legacy, "SGTA50001", "New save", newer);
  const broken = path.join(legacy, "SGTA50008");
  await writeFile(broken, Buffer.alloc(288));
  await utimes(broken, new Date(), new Date());
  await makeSlot(legacy, "SGTA50009.bak", "Backup", new Date());
  await makeSlot(enhanced, "SGTA50000", "Enhanced save", timestamp);

  assert.equal(
    (await readLatestStorySave("gtav", paths, () => true)).automatic?.saveTitle,
    "New save"
  );
  assert.equal(
    (await readLatestStorySave("gtav-enhanced", paths, () => true)).automatic
      ?.saveTitle,
    "Enhanced save"
  );
  let checks = 0;
  assert.equal(
    (await readLatestStorySave("gtav", paths, () => ++checks < 3)).status,
    "waiting"
  );
});

test("reads a selected folder outside Documents and distinguishes invalid files from missing files", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "krysta-custom-save-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const paths = { profiles: [], directFolders: [directory] };
  const scan = () => readLatestStorySave("rdr2", paths, () => true);
  assert.equal((await scan()).status, "not-found");

  const file = path.join(directory, "SRDR30000");
  await writeFile(file, "truncated save");
  assert.equal((await scan()).status, "unreadable");

  await writeFile(file, rockstarSave(4, "Demo (29,3 %)"));
  const result = await scan();
  assert.equal(result.status, "ready");
  assert.equal(result.automatic?.percent, 29.3);
});

test("reads the exact Rockstar save reported by Hydra, leaving unreported sibling slots alone", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "krysta-detected-save-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tracked = path.join(directory, "SRDR30000");
  const other = path.join(directory, "SRDR30001");
  await writeFile(tracked, rockstarSave(4, "Tracked (53%)"));
  await writeFile(other, rockstarSave(4, "Another campaign (80%)"));
  const later = new Date(Date.now() + 10_000);
  await utimes(other, later, later);

  const result = await readLatestStorySave(
    "rdr2",
    { profiles: [], detectedFiles: ["SRDR30001", tracked] },
    () => true
  );
  assert.equal(result.status, "ready");
  assert.equal(result.automatic?.percent, 53);
});

test("reads a recognized save reported by Hydra without a recognized library ID", async (t) => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "krysta-story-identify-")
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const save = path.join(directory, "SRDR30000");
  await writeFile(save, rockstarSave(4, "A saved chapter (53%)"));
  const scan = (files: string[]) =>
    readDiscoveredStorySave(files, undefined, () => true);

  assert.equal((await scan([save])).automatic?.percent, 53);
  assert.equal(
    (await scan([path.join(directory, "missing.sav")])).status,
    "not-found"
  );
  const unsupported = path.join(directory, "other.sav");
  await writeFile(unsupported, "unknown save");
  assert.deepEqual(await scan([unsupported]), {
    automatic: null,
    status: "save-found",
    lastSaveAt: (await stat(unsupported)).mtimeMs,
  });
  const otherGame = path.join(directory, "SGTA50000");
  await writeFile(otherGame, rockstarSave(1, "A different game (91%)"));
  assert.deepEqual(await scan([save, otherGame]), {
    automatic: null,
    status: "save-found",
    lastSaveAt: Math.max(
      (await stat(save)).mtimeMs,
      (await stat(otherGame)).mtimeMs
    ),
  });
});

test("keeps the newest save date for a format without a parser", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "krysta-save-date-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const older = path.join(directory, "first-slot.bin");
  const newer = path.join(directory, "second-slot.bin");
  await writeFile(older, "first slot");
  await writeFile(newer, "second slot");
  const olderDate = new Date("2026-01-01T10:00:00Z");
  const newerDate = new Date("2026-01-02T10:00:00Z");
  await utimes(older, olderDate, olderDate);
  await utimes(newer, newerDate, newerDate);

  const files = [older, newer, directory, path.join(directory, "missing")];
  assert.deepEqual(
    await readDiscoveredStorySave(files, undefined, () => true),
    {
      automatic: null,
      status: "save-found",
      lastSaveAt: newerDate.getTime(),
    }
  );
});

test("reads true campaign flags from the newest valid Far Cry 4 PC save", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "krysta-far-cry-4-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const word = (value: number) => {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32LE(value);
    return buffer;
  };
  const node = (key: number, fields: Buffer[], children: Buffer[]) =>
    Buffer.concat([
      Buffer.of(children.length),
      word(key),
      Buffer.of(fields.length),
      ...fields,
      ...children,
    ]);
  const field = (key: number, value: Buffer) =>
    Buffer.concat([word(key), Buffer.of(value.length), value]);
  const flag = (name: string, value: number) =>
    node(
      0x8ede36e7,
      [
        field(0x3f3ba283, Buffer.from(name + "\0")),
        field(0xee6a8fdf, Buffer.of(value)),
      ],
      []
    );
  const hierarchy = [
    0x586818e3, 0x7e51e3e7, 0xc3205e95, 0xe8de2d18, 0xdc8f68cb, 0xe8d4929f,
    0x25ee66e6, 0x8ede36e7,
  ];
  const makeSave = (flags: Buffer[]) => {
    const body = hierarchy.reduceRight(
      (children, key) => [node(key, [], children)],
      flags
    );
    return Buffer.concat([
      Buffer.alloc(657),
      Buffer.from([0x6e, 0x62, 0x43, 0x46, 2, 0, 0, 0]),
      word(hierarchy.length + flags.length),
      word(flags.length * 2),
      ...body,
    ]);
  };
  const timestamp = new Date("2026-11-21T09:00:00Z");
  const older = path.join(root, "1.save");
  const valid = path.join(root, "SaveSlot1.sav.100");
  const broken = path.join(root, "2.save");
  const save = makeSave([
    flag("mis_090_debriefdone", 1),
    flag("mis_090_debriefdone", 1),
    flag("mis_110_debriefdone", 0),
    flag("mis_210_for_sabal", 1),
  ]);
  await writeFile(older, makeSave([flag("mis_010_alternativeending", 0)]));
  await utimes(
    older,
    new Date(timestamp.getTime() - 1000),
    new Date(timestamp.getTime() - 1000)
  );
  await writeFile(valid, save);
  await utimes(valid, timestamp, timestamp);
  await writeFile(broken, save.subarray(0, -1));

  const source = identifyStorySaveSource({
    shop: "custom",
    objectId: "ubisoft-420",
    title: "Far Cry® 4",
  });
  assert.equal(source, "far-cry-4");
  assert.equal(
    identifyStorySaveSource({ shop: "steam", objectId: "298110" }),
    source
  );
  const expected = {
    automatic: {
      percent: null,
      saveTitle: "",
      completedMissions: 1,
      savedAt: timestamp.getTime(),
    },
    status: "ready",
  };
  assert.deepEqual(
    await readDiscoveredStorySave([older, valid, broken], source, () => true),
    expected
  );
  assert.deepEqual(
    await readLatestStorySave(
      "far-cry-4",
      { profiles: [], directFolders: [root] },
      () => true
    ),
    expected
  );
  assert.equal(
    (await readDiscoveredStorySave([older], source, () => true)).automatic
      ?.completedMissions,
    0
  );
  assert.equal(
    (await readDiscoveredStorySave([broken], source, () => true)).status,
    "unreadable"
  );
});

test("reads the latest GTA IV PC slot from Rockstar folders and discovered files", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "krysta-gta-iv-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const profile = path.join(
    root,
    "Rockstar Games",
    "GTA IV",
    "Profiles",
    "a0b1c2d3"
  );
  await mkdir(profile, { recursive: true });
  const save = path.join(profile, "SGTA400");
  const empty = path.join(profile, "SGTA401");
  const bytes = Buffer.alloc(400);
  bytes.writeUInt32LE(57);
  bytes.write("SAVE", 0x0c, "latin1");
  bytes.write("Drei Blätter", 0x10, "utf16le");
  bytes.write("BLOCK", 0x110, "latin1");
  await writeFile(save, bytes);
  await writeFile(empty, bytes.subarray(0, 260));

  assert.equal(
    identifyStorySaveSource({ shop: "steam", objectId: "12210" }),
    "gtaiv"
  );
  assert.equal(
    identifyStorySaveSource({ shop: "steam", objectId: "12220" }),
    "gtaiv"
  );
  assert.equal(parseGtaIvStoryHeader(Buffer.alloc(400)), null);
  assert.equal(parseGtaIvStoryHeader(bytes.subarray(0, 0x110)), null);

  const latest = await readLatestStorySave(
    "gtaiv",
    { profiles: [{ documents: root, home: root }] },
    () => true
  );
  assert.equal(latest.status, "ready");
  assert.equal(latest.automatic?.saveTitle, "Drei Blätter");
  assert.equal(latest.automatic?.percent, null);
  assert.equal(latest.automatic?.saveTitleKind, "save-title");
  assert.deepEqual(
    await readDiscoveredStorySave([empty, save], undefined, () => true),
    latest
  );
});
