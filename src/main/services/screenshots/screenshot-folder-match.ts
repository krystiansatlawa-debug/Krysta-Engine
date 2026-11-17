/**
 * Older Hydra/Krysta screenshot directories sometimes append a stable
 * hexadecimal game identifier to a sanitized title, e.g.
 * "Game Name-55d3f410a68d". Do not accept arbitrary suffixes or use fuzzy
 * title matching: that could silently assign one game's photos to another.
 */
export const lookupScreenshotGameDirectory = <T>(
  directoryName: string,
  gamesByFolderName: ReadonlyMap<string, T | null>
): T | null => {
  const normalized = directoryName.toLowerCase();

  if (gamesByFolderName.has(normalized)) {
    return gamesByFolderName.get(normalized) ?? null;
  }

  const suffix = normalized.match(/^(.+)-[a-f0-9]{8,32}$/);
  if (!suffix) return null;

  return gamesByFolderName.get(suffix[1]) ?? null;
};
