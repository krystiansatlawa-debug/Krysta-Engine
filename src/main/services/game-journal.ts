import { db } from "@main/level";
import { createGameJournalStore } from "./game-journal-store";
import { logger } from "./logger";
import { WindowManager } from "./window-manager";

const journal = createGameJournalStore(db);
const pendingWrites = new Set<Promise<void>>();

export const readGameJournal = journal.read;

export function recordGameJournalSession(
  gameKey: string,
  startedTick: number,
  endedTick = performance.now()
) {
  const write = journal
    .record(gameKey, startedTick, endedTick)
    .then(() =>
      WindowManager.sendToAppWindows("on-game-journal-changed", gameKey)
    )
    .catch((error: unknown) =>
      logger.error("Failed to save game journal session", error)
    )
    .finally(() => {
      pendingWrites.delete(write);
    });
  pendingWrites.add(write);
  return write;
}

export const flushGameJournalWrites = () => Promise.all(pendingWrites);
