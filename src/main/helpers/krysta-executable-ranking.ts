import {
  isRedistributablePath,
  type KnownGameExecutable,
} from "./game-executable-ranking.js";

/** Never silently select a setup program, shared runtime or ambiguous EXE. */
const BLOCKED =
  /^(?:setup|install|unins|uninstall|unwise|update|updater|patcher|crash|crashreport|crashhandler|reporter|benchmark|config|configuration|anticheat|easyanticheat|eac|vcredist|dxsetup|unitycrashhandler|epicwebhelper|start_protected_game)(?:[._\d-]|\.exe)/i;
export type ExecutableSuggestion = {
  relativePath: string;
  score: number;
  highConfidence: boolean;
};
const normalize = (text: string) =>
  text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
export function rankKrystaExecutableSuggestions(
  relativePaths: readonly string[],
  title: string,
  known: readonly KnownGameExecutable[] = []
): ExecutableSuggestion[] {
  const gameName = normalize(title),
    knownNames = new Set(known.map((k) => k.exe.toLowerCase()));
  const used = new Set<string>(),
    out: ExecutableSuggestion[] = [];
  for (const relativePath of relativePaths) {
    const basename = relativePath.split(/[\\/]/).pop() ?? "";
    if (
      !/\.exe$/i.test(basename) ||
      isRedistributablePath(relativePath) ||
      BLOCKED.test(basename)
    )
      continue;
    const lower = relativePath.toLowerCase();
    if (used.has(lower)) continue;
    used.add(lower);
    const stem = normalize(basename.replace(/\.exe$/i, ""));
    const knownMatch = knownNames.has(basename.toLowerCase());
    const exact = gameName.length >= 4 && stem === gameName;
    const near =
      gameName.length >= 5 &&
      stem.length >= 5 &&
      (stem.startsWith(gameName) ||
        (gameName.startsWith(stem) && stem.length >= gameName.length * 0.7));
    const titleToken =
      gameName.length >= 5 &&
      (stem.includes(gameName) ||
        (gameName.includes(stem) && stem.length >= 5));
    const score = knownMatch
      ? 110
      : exact
        ? 100
        : near
          ? 86
          : titleToken
            ? 68
            : 0;
    out.push({ relativePath, score, highConfidence: score >= 86 });
  }
  return out
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.relativePath.split(/[\\/]/).length -
          b.relativePath.split(/[\\/]/).length ||
        a.relativePath.localeCompare(b.relativePath)
    )
    .slice(0, 12);
}
export function chooseKrystaAutomaticExecutable(
  items: readonly ExecutableSuggestion[]
): string | null {
  if (items.length === 0 || !items[0].highConfidence || items[0].score < 86)
    return null;
  if (items.length > 1 && items[0].score - items[1].score < 20) return null;
  return items[0].relativePath;
}
