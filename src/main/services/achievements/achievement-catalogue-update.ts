import { net } from "electron";
import { db } from "@main/level";
import { isGameBoostBackgroundSyncPaused } from "../game-boost-background-sync";

type Catalogue = { version: number; games: { appId: string; aliases: string[] }[] };
const cache = db.sublevel<string, Catalogue>("achievement-remote-catalogue", { valueEncoding: "json" });
const url = "https://raw.githubusercontent.com/krystiansatlawa-debug/Krysta-Engine/main/resources/achievement-catalogue.json";
let current: Catalogue | undefined;
let lastAttempt = 0;
let pending: Promise<void> | undefined;
const validId = (id: unknown): id is string => typeof id === "string" && /^[1-9]\d{0,9}$/.test(id);
function valid(value: unknown): value is Catalogue {
  if (!value || typeof value !== "object") return false;
  const c = value as Catalogue;
  return Number.isSafeInteger(c.version) && c.version > 0 && Array.isArray(c.games) && c.games.length <= 1000 &&
    c.games.every(g => g && validId(g.appId) && Array.isArray(g.aliases) && g.aliases.length <= 8 && g.aliases.every(validId));
}
export function refreshAchievementCatalogue() {
  if (pending || isGameBoostBackgroundSyncPaused() || Date.now() - lastAttempt < 86400000) return;
  lastAttempt = Date.now();
  pending = (async () => {
    const previous = await cache.get("current").catch(() => undefined);
    if (valid(previous)) current = previous;
    if (isGameBoostBackgroundSyncPaused()) return;
    const response = await net.fetch(url, { signal: AbortSignal.timeout(5000), redirect: "error" });
    if (!response.ok || !response.body) return;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 128 * 1024 || isGameBoostBackgroundSyncPaused()) return;
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const candidate: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!valid(candidate) || (current && candidate.version <= current.version)) return;
    await cache.put("current", candidate);
    current = candidate;
  })().catch(() => {}).finally(() => { pending = undefined; });
}
export function getRemoteAchievementAliases(appId: string): string[] {
  return current?.games.find(g => g.appId === appId)?.aliases ?? [];
}
