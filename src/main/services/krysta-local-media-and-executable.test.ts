import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { build } from "esbuild";
import type { Game, LocalScreenshot } from "@types";

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "krysta-local-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dependencies: Record<string, string> = {
    "test-fixture": `export const state = {
      home: ${JSON.stringify(root)},
      game: null,
      downloads: null,
      screenshots: new Map(),
    };`,
    electron: `
      import { state } from "test-fixture";
      export const app = { getPath: () => state.home + "/Pictures" };
      export const nativeImage = {
        createFromPath: () => ({ getSize: () => ({ width: 1, height: 1 }) }),
      };
      export const ipcMain = { handle: () => {} };`,
    "../system-path": `
      import { state } from "test-fixture";
      export const SystemPath = { getPath: () => state.home };`,
    "../logger": "export const logger = { warn: () => {} };",
    "@shared": "export const SCREENSHOT_CUSTOM_GAME_TITLE_MAX_LENGTH = 120;",
    "@main/level": `
      import { state } from "test-fixture";
      export const levelKeys = { game: (shop, id) => shop + ":" + id };
      export const gamesSublevel = {
        get: async () => state.game,
        put: async (_key, game) => { state.game = game; },
        values: () => ({ all: async () => [state.game] }),
        iterator: () => ({ all: async () => [["custom:fixture", state.game]] }),
      };
      export const downloadsSublevel = { get: async () => state.downloads };`,
    "./local-screenshot-store": `
      import { state } from "test-fixture";
      export const LocalScreenshotStore = {
        listIncludingDeleted: async () => [...state.screenshots.values()],
        put: async (item) => state.screenshots.set(item.clientId, item),
      };`,
    "./local-screenshot-owner":
      'export const getSignedInScreenshotOwnerId = () => "fixture-user";',
    "./screenshot-user-preferences":
      "export const readUserPreferences = async () => null;",
    "@main/helpers/find-game-installer":
      "export const getDownloadFolderPath = async (directory) => directory;",
    "@main/services/game-executables": `
      export const GameExecutables = {
        ensureLoaded: async () => true,
        getExecutablesForGame: () => [],
      };`,
    "@main/services/library-sync/library-write-queue":
      "export const libraryWriteQueue = { run: (task) => task() };",
    "@main/services/steam":
      "export const getSteamLibraryFolders = async () => [];",
    "./krysta-ubisoft": "export const scanUbisoft = async () => null;",
  };

  const result = await build({
    stdin: {
      contents: `
        export { state } from "test-fixture";
        export { importLegacyScreenshots } from "./src/main/services/screenshots/legacy-screenshot-import";
        export { autoLinkKrystaGameExecutable, discoverKrystaGameExecutable }
          from "./src/main/events/krysta-executable-discovery";`,
      resolveDir: process.cwd(),
    },
    tsconfig: path.resolve("tsconfig.node.json"),
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    plugins: [
      {
        name: "krysta-test-fixture",
        setup(plugin) {
          plugin.onResolve({ filter: /.*/ }, ({ path }) =>
            Object.hasOwn(dependencies, path)
              ? { path, namespace: "fixture" }
              : undefined
          );
          plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
            contents: dependencies[path],
          }));
        },
      },
    ],
  });
  const url =
    "data:text/javascript;base64," +
    Buffer.from(result.outputFiles[0].text).toString("base64") +
    "#" +
    randomUUID();
  const fixtureModule = (await import(url)) as {
    state: {
      home: string;
      game: Pick<Game, "shop" | "objectId" | "title" | "executablePath">;
      downloads: string | null;
      screenshots: Map<string, LocalScreenshot>;
    };
    importLegacyScreenshots(): Promise<number>;
    autoLinkKrystaGameExecutable(
      shop: "custom",
      id: string
    ): Promise<string | null>;
    discoverKrystaGameExecutable(
      shop: "custom",
      id: string
    ): Promise<{ automaticPath: string | null }>;
  };
  return { ...fixtureModule, root };
}

test("recovers screenshots from the old Hydra Pictures folder once", async (t) => {
  const f = await fixture(t);
  f.state.game = { shop: "steam", objectId: "123", title: "Fixture Game" };
  const legacyRoot = path.join(f.root, "Pictures", "Hydra");
  const folder = path.join(legacyRoot, "fixture-game");
  const imagePath = path.join(folder, "old.PNG");
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLv0AAAAASUVORK5CYII=",
    "base64"
  );
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(imagePath, image);

  assert.equal(await f.importLegacyScreenshots(), 1);
  const [saved] = f.state.screenshots.values();
  assert.equal(saved.path, imagePath);
  assert.equal(saved.shop, "steam");
  assert.equal(saved.objectId, "123");
  assert.equal(saved.visibility, "PRIVATE");
  const marker = await fs.readFile(
    path.join(legacyRoot, ".hydra-screenshots"),
    "utf8"
  );
  assert.ok(saved.rootMarkerId);
  assert.equal(saved.rootMarkerId, marker);
  assert.deepEqual(await fs.readFile(imagePath), image);
  assert.equal(await f.importLegacyScreenshots(), 0);
  assert.equal(f.state.screenshots.size, 1);
});

test("detects the game EXE and keeps a manually set path during Windows auto-link", async (t) => {
  const f = await fixture(t);
  const title = "Krysta Fixture " + randomUUID();
  f.state.game = { shop: "custom", objectId: "fixture", title };
  f.state.downloads = f.root;
  const executable = path.join(f.root, title + ".exe");
  await fs.writeFile(executable, "");
  await fs.writeFile(path.join(f.root, "setup.exe"), "");

  const found = await f.discoverKrystaGameExecutable("custom", "fixture");
  assert.equal(found.automaticPath, executable);
  if (process.platform === "win32") {
    assert.equal(
      await f.autoLinkKrystaGameExecutable("custom", "fixture"),
      executable
    );
    assert.equal(f.state.game.executablePath, executable);
    const manualPath = path.join(f.root, "manual.exe");
    f.state.game.executablePath = manualPath;
    assert.equal(
      await f.autoLinkKrystaGameExecutable("custom", "fixture"),
      null
    );
    assert.equal(f.state.game.executablePath, manualPath);
  }
});
