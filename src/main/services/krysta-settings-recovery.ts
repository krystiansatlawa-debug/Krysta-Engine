import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

type RecordValue = Record<string, unknown>;
type Name = "cloud" | "fps" | "updates" | "game-updates";
type Result = {
  name: Name;
  state: "valid" | "missing" | "restored" | "defaults" | "error";
};
const object = (x: unknown): x is RecordValue =>
  !!x && typeof x === "object" && !Array.isArray(x);
const opt = (o: RecordValue, k: string, fn: (x: unknown) => boolean) =>
  o[k] === undefined || fn(o[k]);
const bool = (x: unknown) => typeof x === "boolean";
const str = (x: unknown) => typeof x === "string" && x.length <= 32768;
const abs = (x: unknown) => str(x) && path.isAbsolute(x as string);
const hotkey = (x: unknown) =>
  typeof x === "string" &&
  (x === "" ||
    /^(?:(?:Control|Alt|Shift)\+){0,3}(?:F(?:[1-9]|1[0-2])|[A-Z0-9])$/.test(x));
const schemas: Record<
  Name,
  {
    filename: string;
    defaults: RecordValue;
    validate: (o: RecordValue) => boolean;
  }
> = {
  cloud: {
    filename: "krysta-cloud.json",
    defaults: { provider: "hydra", autoBackup: false, syncBeforeLaunch: false },
    validate: (o) =>
      ["google", "synology", "local", "hydra"].includes(String(o.provider)) &&
      opt(o, "folder", abs) &&
      opt(o, "autoBackup", bool) &&
      opt(o, "syncBeforeLaunch", bool),
  },
  fps: {
    filename: "krysta-fps.json",
    defaults: { enabled: false },
    validate: (o) =>
      bool(o.enabled) &&
      opt(o, "tool", abs) &&
      opt(o, "position", (x) => ["tl", "tr", "bl", "br"].includes(String(x))) &&
      opt(o, "output", (x) => x === "window" || x === "rtss") &&
      opt(o, "hotkey", hotkey),
  },
  updates: {
    filename: "krysta-updates.json",
    defaults: { automatic: false, notifications: true },
    validate: (o) =>
      bool(o.automatic) && bool(o.notifications) && opt(o, "seen", str),
  },
  "game-updates": {
    filename: "krysta-game-update-settings.json",
    defaults: {
      enabled: false,
      intervalHours: 6,
      notifications: true,
      startup: true,
      pauseDuringPlay: true,
      autoOpenSteamQueue: false,
      autoDownloadEpic: false,
      backupBeforeUpdate: true,
    },
    validate: (o) =>
      [
        "enabled",
        "notifications",
        "startup",
        "pauseDuringPlay",
        "autoOpenSteamQueue",
        "autoDownloadEpic",
        "backupBeforeUpdate",
      ].every((k) => opt(o, k, bool)) &&
      opt(o, "intervalHours", (x) => [1, 3, 6, 12, 24].includes(x as number)),
  },
};
const maxBytes = 256 * 1024;
const queues = new Map<string, Promise<unknown>>();
function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const job = (queues.get(key) ?? Promise.resolve()).then(fn, fn);
  const tail = job.catch(() => {});
  queues.set(key, tail);
  void tail.finally(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return job;
}
type Read =
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "valid"; value: RecordValue };
async function inspect(
  file: string,
  validate: (o: RecordValue) => boolean
): Promise<Read> {
  let st;
  try {
    st = await fs.lstat(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return { kind: "missing" };
    throw e;
  }
  if (!st.isFile() || st.isSymbolicLink() || st.size > maxBytes)
    throw Error("Unsafe or oversized settings file");
  const raw = await fs.readFile(file, "utf8");
  try {
    const value: unknown = JSON.parse(raw);
    if (object(value) && validate(value)) return { kind: "valid", value };
  } catch {
    /* Preserve damaged input below. */
  }
  return { kind: "invalid" };
}
async function atomic(file: string, value: RecordValue) {
  const data = JSON.stringify(value);
  if (Buffer.byteLength(data) > maxBytes) throw Error("Settings too large");
  const tmp = file + "." + randomUUID() + ".tmp";
  try {
    await fs.writeFile(tmp, data, { flag: "wx", mode: 0o600 });
    await fs.rename(tmp, file);
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}
async function recover(
  root: string,
  name: Name,
  initial?: RecordValue
): Promise<{ value: RecordValue; result: Result }> {
  const s = schemas[name],
    file = path.join(root, s.filename),
    backup = file + ".bak";
  return serial(file, async () => {
    const current = await inspect(file, s.validate);
    if (current.kind === "valid") {
      const b = await inspect(backup, s.validate);
      if (b.kind === "invalid")
        await fs.copyFile(backup, backup + ".corrupt-" + randomUUID(), 1);
      if (b.kind !== "valid") await atomic(backup, current.value);
      return {
        value: { ...s.defaults, ...current.value },
        result: { name, state: "valid" },
      };
    }
    const b = await inspect(backup, s.validate);
    if (current.kind === "missing" && b.kind === "missing")
      return {
        value: { ...s.defaults, ...initial },
        result: { name, state: "missing" },
      };
    // Never discard damaged bytes; preserve an exclusive local copy before replacement.
    if (current.kind === "invalid")
      await fs.copyFile(file, file + ".corrupt-" + randomUUID(), 1);
    if (b.kind === "invalid")
      await fs.copyFile(backup, backup + ".corrupt-" + randomUUID(), 1);
    const value =
      b.kind === "valid" ? { ...s.defaults, ...b.value } : { ...s.defaults };
    await atomic(file, value);
    await atomic(backup, value);
    return {
      value,
      result: { name, state: b.kind === "valid" ? "restored" : "defaults" },
    };
  });
}
export async function readKrystaSettings<T>(
  root: string,
  name: Name,
  initial?: RecordValue
): Promise<T> {
  return (await recover(root, name, initial)).value as T;
}
export async function writeKrystaSettings<T extends object>(
  root: string,
  name: Name,
  value: T
): Promise<T> {
  const s = schemas[name],
    file = path.join(root, s.filename),
    backup = file + ".bak";
  if (!object(value) || !s.validate(value)) throw Error("Invalid settings");
  return serial(file, async () => {
    const current = await inspect(file, s.validate),
      b = await inspect(backup, s.validate);
    if (current.kind === "invalid")
      await fs.copyFile(file, file + ".corrupt-" + randomUUID(), 1);
    if (b.kind === "invalid")
      await fs.copyFile(backup, backup + ".corrupt-" + randomUUID(), 1);
    if (current.kind === "valid") await atomic(backup, current.value);
    await atomic(file, value);
    await atomic(backup, value);
    return value;
  });
}
export async function repairKrystaSettings(root: string): Promise<Result[]> {
  return Promise.all(
    (Object.keys(schemas) as Name[]).map(async (name) => {
      try {
        return (await recover(root, name)).result;
      } catch {
        return { name, state: "error" as const };
      }
    })
  );
}
