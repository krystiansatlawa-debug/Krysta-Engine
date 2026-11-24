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

const applications = new GameBoostApplications({
  list: async () => {
    const processes = await NativeAddon.listProcesses();
    // A failed or incomplete scan must never incorrectly prove a process is gone.
    return processes.some(({ pid }) => pid === process.pid)
      ? processes
      : undefined;
  },
  protectedPaths: async () => {
    const games = await gamesSublevel.values().all();
    return [
      process.execPath,
      ...games.flatMap((game) => [
        ...(game.executablePath ? [game.executablePath] : []),
        ...(game.trackingExecutablePaths ?? []).filter(Boolean),
      ]),
    ];
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
  if (process.platform === "win32")
    applications.sync(
      preferences.enabled && hasTrackedGamesRunning(),
      preferences.closeApplications,
      preferences.restoreApplications
    );
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
  unsubscribe();
  return applications.shutdown();
};
