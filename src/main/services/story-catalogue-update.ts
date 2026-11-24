import { net } from "electron";
import { db } from "@main/level";

type Mission = { title: string; description: string };
type Catalogue = { version: number; games: { source: string; missions: Mission[] }[] };
const cache = db.sublevel<string, Catalogue>("story-remote-catalogue", { valueEncoding: "json" });
const url = "https://raw.githubusercontent.com/krystiansatlawa-debug/Krysta-Engine/main/resources/story-catalogue.json";
let lastAttempt = 0;
let pending: Promise<Catalogue | undefined> | undefined;
function valid(value: unknown): value is Catalogue {
  if (!value || typeof value !== "object") return false;
  const c = value as Catalogue;
  return Number.isSafeInteger(c.version) && c.version > 0 && Array.isArray(c.games) && c.games.length <= 100 &&
    c.games.every(g => g && typeof g.source === "string" && g.source.length <= 80 && Array.isArray(g.missions) && g.missions.length <= 1000 &&
      g.missions.every(m => m && typeof m.title === "string" && m.title.length > 0 && m.title.length <= 160 && typeof m.description === "string" && m.description.length <= 500));
}
async function load(): Promise<Catalogue | undefined> {
  const previous = await cache.get("current").catch(() => undefined);
  if (Date.now() - lastAttempt < 86400000) return previous;
  lastAttempt = Date.now();
  try {
    const response = await net.fetch(url, { signal: AbortSignal.timeout(5000), redirect: "error" });
    if (!response.ok || !response.body) return previous;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 512 * 1024) { await reader.cancel(); return previous; }
      chunks.push(value);
    }
    const candidate: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!valid(candidate) || (previous && candidate.version <= previous.version)) return previous;
    await cache.put("current", candidate);
    return candidate;
  } catch { return previous; }
}
export async function remoteStoryDescription(source: string, title: string) {
  if (!pending) pending = load().finally(() => { pending = undefined; });
  const catalogue = await pending;
  const normalized = (s: string) => s.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}]/gu, "");
  return catalogue?.games.find(g => g.source === (source === "gtav-enhanced" ? "gtav" : source))?.missions.find(m => normalized(m.title) === normalized(title))?.description;
}
