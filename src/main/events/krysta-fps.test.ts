import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

test("retired FPS IPC never starts monitoring, even with legacy enable requests", () => {
  const source = readFileSync(new URL("./krysta-fps.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  runInNewContext(outputText, {
    exports: {},
    require: (name: string) => {
      assert.equal(name, "electron");
      return { ipcMain: { handle: (key: string, handler: (...args: unknown[]) => unknown) => handlers.set(key, handler) } };
    },
    setTimeout: () => { throw Error("FPS timer must not start"); },
    setInterval: () => { throw Error("FPS interval must not start"); },
  });
  assert.equal(handlers.get("krysta:fps-preference")?.(), false);
  assert.equal(handlers.get("krysta:fps-set-preference")?.(null, true), false);
  assert.equal(handlers.get("krysta:fps-hotkey")?.(), "");
  assert.equal((handlers.get("krysta:fps-status")?.() as {status: string}).status, "disabled");
});
