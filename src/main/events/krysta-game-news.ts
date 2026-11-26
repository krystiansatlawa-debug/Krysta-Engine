import { app, ipcMain, net } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

type News = {
  id: string;
  title: string;
  date: number;
  contents: string;
  url: string;
  author: string;
  category: "patch" | "event" | "news";
};
// Normalize display-title decorations only, preserving edition and sequel identities.
export function normalizeNewsTitle(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\((?:tm|r|c)\)/g, "")
    .replace(/[™®©]/g, "")
    .replace(/[^a-z0-9]/g, "");
}
export function category(x: { title: string; tags?: unknown; contents?: string }): News["category"] {
  const tags = Array.isArray(x.tags) ? x.tags.map((t) => String(t).toLowerCase()) : [];
  const title = x.title;
  // Explicit event and promotional titles override generic update wording.
  if (/\b(playtests?|closed beta|open beta|beta test|publisher sale|sale|discounts?|free weekend|giveaway|festival|fest|tournament|livestream|live stream|community event|in-game event|seasonal event|event schedule|event starts|event ends|double xp|free trial|wyprzedaż|turniej|wydarzenie|zamknięty test)\b/i.test(title))
    return "event";
  if (/\b(preview|upcoming|roadmap|coming soon|sneak peek|announcing|announcement|next update|planned|will release|releases on)\b/i.test(title)) return "news";
  if (tags.some(t => /^(patchnotes|patch_notes|patch-notes|hotfix)$/.test(t))) return "patch";
  if (/\b(?:patch notes|release notes|changelog|hotfix(?:es)?|bug fixes|maintenance patch|(?:update|patch|hotfix)\s*#\s*\d+|(?:patch|update|version)\s+v?\d+(?:\.\d+)+|patch\s+v?\d|(?:game|title)\s+update\s+v?\d|lista zmian|poprawki błędów|aktualizacja\s+\d)\b/i.test(title)) return "patch";
  if (/\b(update|patch)\b/i.test(title) && /\b(now live|now available|released|out now|has been deployed|is live)\b/i.test(title)) return "patch";
  if (tags.some(t => /^(event|events|sale|sales|promotion|promotional|playtest|livestream)$/.test(t))) return "event";
  return "news";
}
async function fetchGameNews(
  id: unknown,
  title: unknown,
  metadataOnly = false
) {
  let appId = typeof id === "string" && /^\d{1,10}$/.test(id) ? id : "";
  if (!appId && typeof title === "string" && title.trim()) {
    const q = new URL("https://store.steampowered.com/api/storesearch/");
    q.searchParams.set("term", title.slice(0, 200));
    q.searchParams.set("l", "english");
    q.searchParams.set("cc", "US");
    const res = await net.fetch(q.toString(), {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error("Steam search unavailable");
    const data = await res.json();
    const matches = (Array.isArray(data.items) ? data.items : []).filter(
      (g: { name?: string; id?: number }) =>
        typeof g.name === "string" &&
        normalizeNewsTitle(g.name) === normalizeNewsTitle(title)
    );
    const match = matches.length === 1 ? matches[0] : undefined;
    if (match && /^\d{1,10}$/.test(String(match.id))) appId = String(match.id);
  }
  if (!appId) return { appId: null, items: [] as News[] };
  const url = new URL(
    "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/"
  );
  url.searchParams.set("appid", appId);
  url.searchParams.set("count", "100");
  url.searchParams.set("maxlength", metadataOnly ? "1" : "0");
  url.searchParams.set("feeds", "steam_community_announcements");
  const res = await net.fetch(url.toString(), {
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error("Steam news unavailable");
  const data = await res.json();
  const raw = data?.appnews?.newsitems;
  if (!Array.isArray(raw)) throw new Error("Invalid news response");
  const items: News[] = raw
    .filter(
      (x: any) => typeof x.title === "string" && typeof x.contents === "string"
    )
    .map((x: any) => ({
      id: String(x.gid),
      title: x.title,
      date: Number(x.date) || 0,
      contents: x.contents.slice(0, 60000),
      url: typeof x.url === "string" ? x.url : "",
      author: String(x.author || ""),
      category: category(x),
    }));
  return { appId, items };
}
type NewsResult = Awaited<ReturnType<typeof fetchGameNews>>;
const newsRequests = new Map<string, Promise<NewsResult>>();
export async function getGameNews(
  id: unknown,
  title: unknown,
  metadataOnly = false
): Promise<NewsResult> {
  const key = JSON.stringify([
    typeof id === "string" ? id.slice(0, 40) : "",
    typeof title === "string" ? title.slice(0, 200) : "",
    metadataOnly,
  ]);
  const running = newsRequests.get(key);
  if (running) return running;
  if (newsRequests.size >= 8) throw Error("Too many concurrent news requests");
  const request = fetchGameNews(id, title, metadataOnly).finally(() =>
    newsRequests.delete(key)
  );
  newsRequests.set(key, request);
  return request;
}
ipcMain.handle("krysta:game-news", (_event, id: unknown, title: unknown) =>
  getGameNews(id, title)
);

// Local translation only: article text never leaves the computer.
const translations = new Map<string, { title: string; content: string }>();
let translationQueue: Promise<unknown> = Promise.resolve();
const translationRequests = new Map<
  string,
  Promise<{ title: string; content: string } | null>
>();
async function localTranslate(
  title: string,
  content: string
): Promise<{ title: string; content: string }> {
  const root = path.join(process.resourcesPath, "krysta-translate");
  const python = path.join(root, "python.exe");
  const helper = path.join(root, "krysta-translate.py");
  await fs.access(python);
  await fs.access(helper);
  const models = path.join(app.getPath("userData"), "translation-models");
  return new Promise((resolve, reject) => {
    const child = spawn(python, ["-I", "-X", "utf8", helper, models], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      cwd: root,
    });
    let output = "",
      done = false;
    const finish = (
      error?: Error,
      result?: { title: string; content: string }
    ) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result!);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(Error("Translation timeout"));
    }, 300000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.length > 1000000) {
        child.kill();
        finish(Error("Translation too large"));
      }
    });
    child.stderr.resume();
    child.on("error", finish);
    child.stdin.on("error", finish);
    child.on("close", (code) => {
      try {
        if (code !== 0) throw Error("Local translator failed");
        const data = JSON.parse(output);
        if (typeof data.title !== "string" || typeof data.content !== "string")
          throw Error("Invalid local translation");
        finish(undefined, data);
      } catch {
        finish(Error("Translation unavailable"));
      }
    });
    child.stdin.end(JSON.stringify({ title, content }), "utf8");
  });
}
ipcMain.handle(
  "krysta:news-translate",
  (_event, title: unknown, content: unknown) => {
    if (
      process.platform !== "win32" ||
      typeof title !== "string" ||
      typeof content !== "string" ||
      title.length > 1000 ||
      content.length > 60000
    )
      return null;
    const cacheKey = JSON.stringify([title, content]),
      cached = translations.get(cacheKey);
    if (cached) return cached;
    const running = translationRequests.get(cacheKey);
    if (running) return running;
    if (translationRequests.size >= 3) return null;
    const task = translationQueue
      .then(async () => {
        const previous = translations.get(cacheKey);
        if (previous) return previous;
        const result = await localTranslate(title, content);
        if (translations.size >= 16)
          translations.delete(translations.keys().next().value!);
        translations.set(cacheKey, result);
        return result;
      })
      .catch(() => null)
      .finally(() => translationRequests.delete(cacheKey));
    translationRequests.set(cacheKey, task);
    translationQueue = task;
    return task;
  }
);


// Independent Steam storefront catalogue; only requested by the visible catalogue.
import { hasTrackedGamesRunning, onTrackedGamesRunningChange } from "@main/services/game-running-state";
type SteamCatalogueEntry = { id: string; title: string; image: string };
type SteamCatalogueSnapshot = { newReleases: SteamCatalogueEntry[]; upcoming: SteamCatalogueEntry[]; checkedAt: number };
let catalogueRequest: Promise<SteamCatalogueSnapshot | null> | null = null;
const catalogueFile = () => path.join(app.getPath("userData"), "steam-catalogue-cache.json");
function steamEntries(section: unknown): SteamCatalogueEntry[] {
  const items = (section as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  const result = new Map<string, SteamCatalogueEntry>();
  for (const item of items) {
    const id = String(item?.id ?? "");
    if (!/^\d{1,10}$/.test(id) || typeof item?.name !== "string" ||
      (item.type !== undefined && item.type !== 0)) continue;
    result.set(id, { id, title: item.name.slice(0, 250),
      image: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/" + id + "/header.jpg" });
  }
  return [...result.values()].slice(0, 30);
}
async function steamCatalogue(): Promise<SteamCatalogueSnapshot | null> {
  if (hasTrackedGamesRunning()) return null;
  if (catalogueRequest) return catalogueRequest;
  const controller = new AbortController();
  const unsubscribe = onTrackedGamesRunningChange(() => {
    if (hasTrackedGamesRunning()) controller.abort();
  });
  catalogueRequest = (async () => {
    let cached: SteamCatalogueSnapshot | null = null;
    try {
      const value = JSON.parse(await fs.readFile(catalogueFile(), "utf8"));
      if (Array.isArray(value.newReleases) && Array.isArray(value.upcoming) &&
          typeof value.checkedAt === "number") cached = value;
    } catch { /* cache not yet available */ }
    if (controller.signal.aborted) return null;
    if (cached && Date.now() - cached.checkedAt < 30 * 60_000) return cached;
    try {
      const response = await net.fetch("https://store.steampowered.com/api/featuredcategories/?cc=PL&l=polish", {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      });
      if (!response.ok) throw Error("Steam catalogue unavailable");
      const data = await response.json();
      if (!Array.isArray(data?.new_releases?.items) || !Array.isArray(data?.coming_soon?.items))
        throw Error("Invalid Steam catalogue response");
      const snapshot = { newReleases: steamEntries(data.new_releases), upcoming: steamEntries(data.coming_soon), checkedAt: Date.now() };
      if (controller.signal.aborted) return null;
      await fs.writeFile(catalogueFile(), JSON.stringify(snapshot), "utf8").catch(() => {});
      return snapshot;
    } catch { return controller.signal.aborted ? null : cached; }
  })().finally(() => { unsubscribe(); catalogueRequest = null; });
  return catalogueRequest;
}
ipcMain.handle("krysta:steam-catalogue", () => steamCatalogue());
