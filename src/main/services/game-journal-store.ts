import type { ClassicLevel } from "classic-level";
import type { GameJournalPage, GameJournalSession } from "@types";

export function createGameJournalStore(db: ClassicLevel) {
  const sessions = db.sublevel<string, GameJournalSession>("game-journal", {
    valueEncoding: "json",
  });
  const prefixFor = (gameKey: string) => JSON.stringify(gameKey) + ":";

  return {
    async record(gameKey: string, startedTick: number, endedTick: number) {
      const startedAt = Math.floor(performance.timeOrigin + startedTick);
      const endedAt = Math.floor(performance.timeOrigin + endedTick);
      const id =
        prefixFor(gameKey) +
        String(startedAt).padStart(15, "0") +
        ":" +
        startedTick;
      await sessions.put(id, { id, startedAt, endedAt });
    },

    async read(gameKeys: string[], limit: number): Promise<GameJournalPage> {
      const recent = await Promise.all(
        gameKeys.map((gameKey) => {
          const prefix = prefixFor(gameKey);
          return sessions
            .values({
              gte: prefix,
              lt: prefix + "\uffff",
              reverse: true,
              limit: limit + 1,
            })
            .all();
        })
      );
      const ordered = recent.flat().sort((a, b) => b.startedAt - a.startedAt);

      return {
        sessions: ordered.slice(0, limit),
        hasMore: ordered.length > limit,
      };
    },
  };
}
