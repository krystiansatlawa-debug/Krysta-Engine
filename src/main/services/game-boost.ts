import { spawn } from "node:child_process";
import path from "node:path";
import { gamesSublevel } from "@main/level";
import type { UserPreferences } from "@types";
import {
  getGameBoostPreferences,
  MAX_GAME_BOOST_APPLICATIONS,
} from "../../shared/game-boost-preferences";
import {
  GameBoostApplications,
  normalizeGameBoostApplicationPaths,
  windowsExecutableKey,
} from "./game-boost-applications";
import { syncGameBoostBackgroundSyncPreferences } from "./game-boost-background-sync";
import {
  hasTrackedGamesRunning,
  onTrackedGamesRunningChange,
} from "./game-running-state";
import { logger } from "./logger";
import { NativeAddon } from "./native-addon";

let preferences = getGameBoostPreferences(null);
let gameWasRunning = false;
let minimizeTimer: ReturnType<typeof setTimeout> | undefined;
let shuttingDown = false;
let sessionGeneration = 0;

const applications = new GameBoostApplications({
  list: async () => {
    const processes = await NativeAddon.listProcesses();
    // A failed or incomplete scan must never incorrectly prove a process is gone.
    return processes.some(({ pid }) => pid === process.pid)
      ? processes
      : undefined;
  },
  protectedPaths: async () => {
    const paths = new Set<string>([process.execPath]);
    for (const application of await NativeAddon.listProcesses()) {
      if (application.exe && protectedNames.has(path.win32.basename(application.exe).toLowerCase())) paths.add(application.exe);
    }
    for await (const game of gamesSublevel.values()) {
      if (game.executablePath) paths.add(game.executablePath);
      for (const executable of game.trackingExecutablePaths ?? []) {
        if (executable) paths.add(executable);
      }
    }
    return [...paths];
  },
  close: ({ pid }, executable) =>
    NativeAddon.requestWindowsBackgroundApplicationClose(pid, executable),
  reopen: (executable) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(executable, [], {
        cwd: path.win32.dirname(executable),
        detached: true,
        stdio: "ignore",
      });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    }),
  reportError: (error) =>
    logger.warn("[Game Boost] Background application", error),
});

const getAllowedApplicationPaths = (paths: unknown) => {
  const systemRoot = windowsExecutableKey(
    process.env.SystemRoot || "C:\\Windows"
  );
  return normalizeGameBoostApplicationPaths(
    paths,
    MAX_GAME_BOOST_APPLICATIONS
  ).filter(
    (executable) =>
      !windowsExecutableKey(executable).startsWith(systemRoot + "\\")
  );
};

const protectedNames = new Set(["steam.exe", "steamwebhelper.exe", "rockstarservice.exe", "launcher.exe", "socialclubhelper.exe", "ubisoftconnect.exe", "upc.exe", "epicgameslauncher.exe", "gamingservices.exe", "explorer.exe", "discord.exe"].filter(name => name !== "discord.exe"));
export const listGameBoostCandidates = async () => {
  if (process.platform !== "win32") return [];
  const processes = await NativeAddon.listProcesses();
  const games = await gamesSublevel.values().all();
  const protectedKeys = new Set([process.execPath, ...games.flatMap(game => [game.executablePath, ...(game.trackingExecutablePaths ?? [])].filter((p): p is string => Boolean(p)))].map(windowsExecutableKey));
  return getAllowedApplicationPaths(processes.map(p => p.exe))
    .filter(exe => !protectedKeys.has(windowsExecutableKey(exe)) && !protectedNames.has(path.win32.basename(exe).toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
};

const syncApplications = () => {
  if (process.platform !== "win32" || shuttingDown) return;
  const running = hasTrackedGamesRunning();
  const ended = gameWasRunning && !running;
  if (gameWasRunning !== running) sessionGeneration++;
  const generation = sessionGeneration;
  gameWasRunning = running;
  applications.sync(preferences.enabled && running, preferences.closeApplications, preferences.restoreApplications);
  if (running || !preferences.enabled || !preferences.minimizeAfterGame) {
    if (minimizeTimer) clearTimeout(minimizeTimer);
    minimizeTimer = undefined;
  }
  if (ended && preferences.enabled && preferences.minimizeAfterGame) {
    void applications.waitForIdle().then(() => {
      if (generation !== sessionGeneration || shuttingDown || hasTrackedGamesRunning() || !preferences.enabled || !preferences.minimizeAfterGame) return;
      minimizeTimer = setTimeout(() => {
        minimizeTimer = undefined;
        if (generation !== sessionGeneration || shuttingDown || hasTrackedGamesRunning() || !preferences.enabled || !preferences.minimizeAfterGame) return;
        const powershell = path.win32.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
        const child = spawn(powershell, ["-NoProfile", "-NonInteractive", "-Command", "(New-Object -ComObject Shell.Application).MinimizeAll()"], { windowsHide: true, stdio: "ignore" });
        child.once("error", error => logger.warn("[Game Boost] Minimize windows", error));
      }, 2000);
    }).catch(error => logger.warn("[Game Boost] Restore before minimizing", error));
  }
};

const unsubscribe = onTrackedGamesRunningChange(syncApplications);

export const normalizeGameBoostPreferencePatch = (
  patch: Partial<UserPreferences>
) => {
  const result = { ...patch };
  for (const key of [
    "gameBoostEnabled",
    "gameBoostPauseBackgroundSync",
    "gameBoostRestoreApplications",
    "gameBoostMinimizeAfterGame",
  ] as const) {
    if (typeof result[key] !== "boolean") delete result[key];
  }
  if (Object.hasOwn(result, "gameBoostCloseApplications"))
    result.gameBoostCloseApplications = getAllowedApplicationPaths(
      result.gameBoostCloseApplications
    );
  return result;
};

export const syncGameBoostPreferences = (
  updatedPreferences: UserPreferences | null
) => {
  preferences = getGameBoostPreferences(updatedPreferences);
  preferences.closeApplications = getAllowedApplicationPaths(
    preferences.closeApplications
  );
  syncGameBoostBackgroundSyncPreferences(updatedPreferences);
  syncApplications();
};

export const shutdownGameBoost = () => {
  shuttingDown = true;
  if (minimizeTimer) clearTimeout(minimizeTimer);
  unsubscribe();
  return applications.shutdown();
};
