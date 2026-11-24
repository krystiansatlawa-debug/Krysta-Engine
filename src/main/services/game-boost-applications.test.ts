import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import {
  GameBoostApplications,
  normalizeGameBoostApplicationPaths,
} from "./game-boost-applications.js";

const app = "C:\\Selected Apps\\Chat.exe";
const other = "C:\\Other\\Chat.exe";
const game = "D:\\Games\\Game.exe";

test("accepts unique absolute local executables up to the configured limit", () => {
  assert.deepEqual(
    normalizeGameBoostApplicationPaths(
      [
        "Chat.exe",
        "\\\\share\\Chat.exe",
        "C:\\Folder\\script.cmd",
        "C:\\Folder\\app.exe:other.exe",
        "C:/Selected Apps/Chat.exe",
        app.toLowerCase(),
        other,
        game,
      ],
      2
    ),
    [app, other]
  );
});

test("closes only the selected application and restores it once after gameplay", async () => {
  let processes = [
    { pid: 1, exe: app.toLowerCase() },
    { pid: 2, exe: other },
    { pid: 3, exe: game },
  ];
  const closed: number[] = [];
  const reopened: string[] = [];
  const boost = new GameBoostApplications({
    list: async () => processes,
    protectedPaths: async () => [game],
    close: ({ pid }) => {
      closed.push(pid);
      processes = processes.filter((process) => process.pid !== pid);
      return true;
    },
    reopen: async (executable) => {
      reopened.push(executable);
    },
    reportError: (error) => assert.fail(String(error)),
  });

  boost.sync(true, [app, game], true);
  await setImmediate();
  assert.deepEqual(closed, [1]);
  boost.sync(true, [app, game], true);
  await setImmediate();
  assert.deepEqual(closed, [1]);
  assert.deepEqual(reopened, []);
  await boost.shutdown();
  assert.deepEqual(reopened, [app]);
});

test("does not duplicate a still running app or restore when disabled", async () => {
  for (const restore of [true, false]) {
    let processes = [{ pid: 1, exe: app }];
    let closeCount = 0;
    const boost = new GameBoostApplications({
      list: async () => processes,
      protectedPaths: async () => [],
      close: () => {
        closeCount++;
        if (!restore) processes = [];
        return true;
      },
      reopen: async () => assert.fail("unexpected reopen"),
      reportError: (error) => assert.fail(String(error)),
    });
    boost.sync(true, [app], restore);
    await setImmediate();
    await boost.shutdown();
    assert.equal(closeCount, 1);
  }
});

test("does not mistake a failed process scan for proof that an app closed", async () => {
  let scanned = false;
  const boost = new GameBoostApplications({
    list: async () => {
      if (scanned) return undefined;
      scanned = true;
      return [{ pid: 1, exe: app }];
    },
    protectedPaths: async () => [],
    close: () => true,
    reopen: async () => assert.fail("unexpected reopen"),
    reportError: (error) => assert.fail(String(error)),
  });
  boost.sync(true, [app], true);
  await setImmediate();
  await boost.shutdown();
});

test("does not duplicate an app whose running executable path is inaccessible", async () => {
  let scanned = false;
  const boost = new GameBoostApplications({
    list: async () => {
      if (scanned) return [{ pid: 1, exe: null, name: "Chat.exe" }];
      scanned = true;
      return [{ pid: 1, exe: app }];
    },
    protectedPaths: async () => [],
    close: () => true,
    reopen: async () => assert.fail("unexpected reopen"),
    reportError: (error) => assert.fail(String(error)),
  });
  boost.sync(true, [app], true);
  await setImmediate();
  await boost.shutdown();
});
