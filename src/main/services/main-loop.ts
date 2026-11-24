import {
  isGameBoostBackgroundSyncPaused,
  onGameBoostBackgroundSyncChange,
  waitForGameBoostBackgroundSync,
} from "./game-boost-background-sync";
import { sleep } from "@main/helpers";
import { DownloadManager } from "./download";
import { gamesPlaytime, watchProcesses } from "./process-watcher";
import { AchievementWatcherManager } from "./achievements/achievement-watcher-manager";
import { UpdateManager } from "./update-manager";
import { INTERVALS } from "@main/constants";
import { PowerSaveBlockerManager } from "./power-save-blocker";
import { logger } from "./logger";
import { DownloadOrchestrator } from "./download-orchestrator";
import { refreshQueuedStoryProgress } from "./automatic-story-progress";
import { exportKrystaCloudBackup } from "./krysta-cloud-backup";

const wrapInLoop = (
  fn: () => unknown,
  interval: number,
  deferDuringGame = false
) => {
  const loop = async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (deferDuringGame && isGameBoostBackgroundSyncPaused()) {
        await waitForGameBoostBackgroundSync();
        continue;
      }

      try {
        await fn();
      } catch (error) {
        logger.error(
          `Error in loop: ${error instanceof Error ? error.stack : String(error)}`
        );
      }

      if (!deferDuringGame) {
        await sleep(interval);
      } else if (!isGameBoostBackgroundSyncPaused()) {
        await new Promise<void>((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            unsubscribe();
            resolve();
          };
          const timer = setTimeout(finish, interval);
          const unsubscribe = onGameBoostBackgroundSyncChange(finish);
        });
      }
    }
  };
  loop();
};

let mainLoopStarted = false;
export const startMainLoop = async () => {
  if (mainLoopStarted) return;
  mainLoopStarted = true;
  if (process.env.KRYSTA_BACKUP_FOLDER) wrapInLoop(() => exportKrystaCloudBackup(), 60_000, true);
  wrapInLoop(async () => {
    await watchProcesses();
    refreshQueuedStoryProgress();
  }, INTERVALS.processWatcher);
  wrapInLoop(() => DownloadManager.watchDownloads(), INTERVALS.downloadWatcher);
  wrapInLoop(
    () => DownloadOrchestrator.pollAwaitingDebridDownloads(),
    INTERVALS.debridReadinessWatcher,
    true
  );
  wrapInLoop(
    () => AchievementWatcherManager.watchAchievements(),
    INTERVALS.achievementWatcher
  );
  wrapInLoop(
    () => DownloadManager.getSeedStatus(),
    INTERVALS.seedStatusWatcher,
    true
  );
  wrapInLoop(
    () => UpdateManager.checkForUpdates(),
    INTERVALS.updateChecker,
    true
  );

  wrapInLoop(() => {
    PowerSaveBlockerManager.syncState({
      downloadActive: DownloadManager.hasActiveDownload(),
      compatibilityGameActive:
        PowerSaveBlockerManager.hasRunningCompatibilityGame(
          gamesPlaytime.keys()
        ),
    });
  }, INTERVALS.powerSaveBlockerSync);
};
