import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { presentUbisoftAchievements } from "../../services/achievements/ubisoft-achievement-presentation.js";

test("Ubisoft-owned games load real account unlocks without writing Steam/Epic state", async () => {
  const gameId = "ubi-owned-" + "a".repeat(32);
  const reads: string[] = [];
  const stubs: Record<string, unknown> = {
    "../register-event": { registerEvent: () => undefined },
    "@main/services/hydra-api": {
      HydraApi: { getAuthContext: () => null },
    },
    "@main/services/achievements/achievement-sync-coordinator": {
      achievementSyncCoordinator: {
        captureCurrent: () => () => true,
      },
      AchievementSyncCancelledError: class extends Error {},
    },
    "@main/services/achievements/achievement-watcher-manager": {},
    "@main/services/achievements/achievement-memory-store": {},
    "@main/services/achievements/unlocked-achievements-cache": {},
    "@main/services/achievements/achievement-souvenir-store": {},
    "@main/services/achievements/get-game-achievement-data": {},
    "@main/services/achievements/get-achievement-souvenirs": {},
    "@main/services/achievements/merge-unlocked-achievements": {},
    "@main/services/achievements/combined-achievements-requests": {},
    "@main/services/achievements/combined-achievement-presentation": {},
    "@main/level": {
      db: {
        get: () => {
          throw Error("Ubisoft must not read the Hydra achievement store");
        },
      },
      levelKeys: { game: (shop: string, id: string) => `${shop}:${id}` },
    },
    "../krysta-ubisoft-account": {
      getUbisoftAchievementsForLibrary: async (
        id: string,
        force: boolean
      ) => {
        assert.equal(id, gameId);
        assert.equal(force, false);
        reads.push("ubisoft");
        return {
          items: [
            {
              id: "7013-1",
              title: "Ubisoft trophy",
              description: "Verified account achievement",
              icon: null,
              unlocked: true,
              completionDate: "2026-11-20T14:00:00",
            },
          ],
        };
      },
    },
    "@main/services/achievements/ubisoft-achievement-presentation": {
      presentUbisoftAchievements,
    },
  };
  const output = ts.transpileModule(
    readFileSync(new URL("./get-unlocked-achievements.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }
  ).outputText;
  const exported = {} as {
    getUnlockedAchievements: (
      id: string,
      shop: string,
      useCachedData: boolean
    ) => Promise<Array<{ name: string; unlocked: boolean; unlockTime: number | null }>>;
  };
  new Function("exports", "require", output)(
    exported,
    (name: string) => {
      assert.ok(name in stubs, "Unexpected dependency: " + name);
      return stubs[name];
    }
  );
  const rows = await exported.getUnlockedAchievements(gameId, "custom", true);
  assert.deepEqual(reads, ["ubisoft"]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "ubisoft:7013-1");
  assert.equal(rows[0].unlocked, true);
  assert.equal(rows[0].unlockTime, Date.parse("2026-11-20T14:00:00Z"));
});
