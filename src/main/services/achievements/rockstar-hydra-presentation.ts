import type { SteamAchievement, UserAchievement } from "@types";
import type { RockstarUnlockedAchievement } from "./rockstar-achievement-parser.js";
import { toHydraRockstarUnlocks } from "./rockstar-hydra-adapter.js";

/**
 * Feed Rockstar unlocks to Hydra's EXISTING achievement list.
 * Definitions must belong to the same game. Unmatched unlock IDs are ignored,
 * not presented as fabricated achievements. No Steam/Epic state is modified.
 */
export function presentRockstarInHydra(
  definitions: readonly SteamAchievement[],
  verifiedUnlocks: readonly RockstarUnlockedAchievement[]
): UserAchievement[] {
  const unlocks = new Map(
    toHydraRockstarUnlocks(verifiedUnlocks).map(item => [
      item.name.toUpperCase(),
      item.unlockTime,
    ])
  );
  return definitions.map(definition => {
    const unlockTime = unlocks.get(definition.name.toUpperCase()) ?? null;
    return {
      ...definition,
      unlocked: unlockTime !== null,
      unlockTime,
      icongray: definition.icongray || definition.icon,
    };
  });
}
