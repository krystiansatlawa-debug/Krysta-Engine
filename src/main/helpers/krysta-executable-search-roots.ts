import path from "node:path";

/** Executables for manually added library entries are looked up by their
 * Steam catalogue identity, not by an unrelated custom library object id. */
export const krystaExecutableSteamId = (game: {
  shop: string;
  objectId: string;
  catalogueGame?: { shop?: string; objectId?: string } | null;
}): string | null => {
  const id =
    game.catalogueGame?.shop === "steam"
      ? game.catalogueGame.objectId
      : game.shop === "steam"
        ? game.objectId
        : null;
  return id && /^\d{1,10}$/.test(id) ? id : null;
};

const safeFolder = (name: string): string =>
  name
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 100);

export const krystaGameDirectoryNames = (title: string): string[] => {
  const variants = [
    safeFolder(title),
    safeFolder(title.replace(/['’]/g, "")),
    safeFolder(title.replace(/\s*\([^)]{1,60}\)\s*/g, " ")),
    safeFolder(title.replace(/['’]/g, "").replace(/\s*\([^)]{1,60}\)\s*/g, " ")),
  ];
  return [...new Set(variants.filter((name) => name.length >= 4 && name !== "." && name !== ".."))];
};

/** Only exact-title game folders under known install directories; never scan
 * an entire drive, Program Files directory or a neighbouring game install. */
export function krystaCandidateInstallRoots(
  title: string,
  drives: readonly string[]
): string[] {
  const directories = [
    "Games",
    "GOG Games",
    "Epic Games",
    "Ubisoft Games",
    "Rockstar Games",
    "Installed Games",
    "SteamLibrary\\steamapps\\common",
    "",
  ];
  const names = krystaGameDirectoryNames(title);
  const result: string[] = [];
  const seen = new Set<string>();
  for (const drive of drives) {
    if (!/^[A-Z]:$/i.test(drive)) continue;
    for (const installRoot of directories) {
      for (const name of names) {
        const location = path.win32.join(drive + "\\", installRoot, name);
        const key = location.toLowerCase();
        if (!seen.has(key)) {
          result.push(location);
          seen.add(key);
        }
      }
    }
  }
  return result;
}

export const krystaCandidateWindowsDrives = (systemDrive = "C:"): string[] => [
  ...new Set(
    [systemDrive.toUpperCase(), ..."CDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => letter + ":")]
      .filter((drive) => /^[A-Z]:$/.test(drive))
  ),
];
