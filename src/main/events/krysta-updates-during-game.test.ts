import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import ts from "typescript";

const tag = "v1.0.3";
const name = "krysta-launcher-1.0.3-setup.exe";
const url =
  "https://github.com/krystiansatlawa-debug/Krysta-Engine/releases/download/" +
  tag +
  "/" +
  name;
const bytes = "sample installer bytes";
const digest = "sha256:" + createHash("sha256").update(bytes).digest("hex");

function releaseCandidate(tagName: string, releaseName: string) {
  const installer = `krysta-launcher-${tagName.slice(1)}-setup.exe`;
  return {
    name: releaseName,
    tag_name: tagName,
    assets: [
      {
        name: installer,
        digest,
        size: bytes.length,
        browser_download_url: `https://github.com/krystiansatlawa-debug/Krysta-Engine/releases/download/${tagName}/${installer}`,
      },
    ],
  };
}

async function fixture(
  t: TestContext,
  {
    automatic = true,
    blockFirstDownload = false,
    releases = [releaseCandidate(tag, "Krysta Launcher 1.0.3")],
  } = {}
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "krysta-update-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let running = false;
  const listeners = new Set<() => void>();
  const requests: AbortSignal[] = [];
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const dependencies: Record<string, unknown> = {
    "@main/services/krysta-settings-recovery": {
      readKrystaSettings: async () => ({
        automatic,
        notifications: false,
      }),
    },
    "@main/services/game-running-state": {
      hasTrackedGamesRunning: () => running,
      onTrackedGamesRunningChange: (fn: () => void) => listeners.add(fn),
    },
    electron: {
      app: {
        isPackaged: true,
        getPath: () => root,
        getVersion: () => "1.0.2",
        whenReady: async () => {},
        once: () => {},
      },
      ipcMain: {
        handle: (event: string, fn: (...args: unknown[]) => unknown) =>
          handlers.set(event, fn),
      },
    },
  };
  const fetchMock = async (input: string | URL, options: RequestInit) => {
    const address = String(input);
    if (address.startsWith("https://api.github.com/"))
      return Response.json(releases);
    assert.equal(address, url);
    const signal = options.signal!;
    requests.push(signal);
    if (blockFirstDownload && requests.length === 1) {
      return new Promise<Response>((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    }
    return new Response(bytes);
  };
  const source = await fs.readFile(
    new URL("./krysta-updates.ts", import.meta.url),
    "utf8"
  );
  const { outputText } = ts.transpileModule(
    source.replaceAll("import.meta.env", "({})"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }
  );
  const requireModule = createRequire(import.meta.url);
  new Function(
    "exports",
    "require",
    "fetch",
    "process",
    "setTimeout",
    "setInterval",
    outputText
  )(
    {},
    (key: string) => dependencies[key] ?? requireModule(key),
    fetchMock,
    { platform: "win32", arch: "x64", env: {} },
    () => {},
    () => {}
  );
  await Promise.resolve();
  const call = (key: string) => handlers.get("krysta:updates-" + key)!();
  return {
    requests,
    cache: path.join(root, "krysta-update-cache"),
    check: () => call("check"),
    status: () => (call("status") as { phase: string }).phase,
    gameRunning(value: boolean) {
      running = value;
      for (const fn of listeners) fn();
    },
  };
}

async function until(condition: () => boolean) {
  for (let i = 0; i < 150; i++) {
    if (condition()) return;
    await sleep(10);
  }
  assert.ok(condition(), "Update did not reach the expected state");
}

test("defers a Krysta installer download until the running game closes", async (t) => {
  const f = await fixture(t);
  f.gameRunning(true);
  await f.check();
  assert.equal(f.status(), "paused");
  assert.equal(f.requests.length, 0);

  f.gameRunning(false);
  await until(() => f.status() === "ready");
  assert.equal(f.requests.length, 1);
  assert.equal(await fs.readFile(path.join(f.cache, name), "utf8"), bytes);
});

test("aborts the pending installer on game start and retries after exit", async (t) => {
  const f = await fixture(t, { blockFirstDownload: true });
  await f.check();
  await until(() => f.requests.length === 1);
  f.gameRunning(true);
  await until(() => f.status() === "paused");
  assert.equal(f.requests[0].aborted, true);
  assert.deepEqual(await fs.readdir(f.cache), []);

  f.gameRunning(false);
  await until(() => f.status() === "ready");
  assert.equal(f.requests.length, 2);
  assert.deepEqual(await fs.readdir(f.cache), [name]);
});

test("selects the newest stable Krysta Engine or Launcher release", async (t) => {
  const draft = {
    ...releaseCandidate("v1.0.30", "Krysta Engine 1.0.30"),
    draft: true,
  };
  const prerelease = {
    ...releaseCandidate("v1.0.29", "Krysta Launcher 1.0.29"),
    prerelease: true,
  };
  const f = await fixture(t, {
    automatic: false,
    releases: [
      releaseCandidate("v1.0.26", "Krysta Launcher 1.0.26"),
      releaseCandidate("v1.0.28", "Hydra Launcher 1.0.28"),
      draft,
      releaseCandidate("v1.0.27", "Krysta Engine 1.0.27 – Kontrolery"),
      prerelease,
    ],
  });
  const result = (await f.check()) as {
    krysta: { tag: string } | null;
    krystaNew: boolean | null;
  };

  assert.equal(result.krysta?.tag, "v1.0.27");
  assert.equal(result.krystaNew, true);
  assert.equal(f.status(), "manual");
});
