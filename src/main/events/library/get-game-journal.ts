import { gamesSublevel } from "@main/level";
import { getContextualEpicGame } from "@main/services/epic/import-visibility";
import { readGameJournal } from "@main/services/game-journal";
import { HydraApi } from "@main/services/hydra-api";
import { registerEvent } from "../register-event";

registerEvent(
  "getGameJournal",
  async (
    _event: Electron.IpcMainInvokeEvent,
    gameKeys: string[],
    limit: number
  ) => {
    if (
      !Array.isArray(gameKeys) ||
      !gameKeys.every((key) => typeof key === "string") ||
      !Number.isSafeInteger(limit) ||
      limit < 1
    ) {
      throw new Error("Invalid game journal request");
    }

    const authContext = HydraApi.getAuthContext();
    const visibleKeys = await Promise.all(
      Array.from(new Set(gameKeys), async (key) => {
        const game = await gamesSublevel.get(key);
        return game && !getContextualEpicGame(game, authContext).isDeleted
          ? key
          : null;
      })
    );

    return readGameJournal(
      visibleKeys.filter((key) => key !== null),
      limit
    );
  },
  { jsonSafeResult: true }
);
