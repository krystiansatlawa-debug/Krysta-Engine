import type { Game } from "@types";

/** Imported games launch through their official clients. Never replace manually chosen executables. */
export function canAutoLinkKrystaExecutable(
  game:
    | Pick<
        Game,
        | "isDeleted"
        | "source"
        | "hasActiveSteamImport"
        | "hasActiveEpicImport"
        | "executablePath"
      >
    | null
    | undefined
): boolean {
  return Boolean(
    game &&
      !game.isDeleted &&
      !game.executablePath &&
      !game.hasActiveSteamImport &&
      !game.hasActiveEpicImport &&
      game.source !== "steam" &&
      game.source !== "epic"
  );
}
