import { Cracker } from "@shared";
import { UnlockedAchievement } from "@types";
import { existsSync, readdirSync } from "node:fs";
import { achievementsLogger } from "../logger";
import {
  iniParse,
  isExplicitAchievementUnlock,
  jsonParse,
  process3DM,
  processCreamAPI,
  processDefault,
  processGoldberg,
  processOnlineFix,
  processRazor1911,
  processRld,
  processSkidrow,
  processUserStats,
} from "./parse-achievement-formats";

const processFltFolder = (filePath: string): UnlockedAchievement[] =>
  readdirSync(filePath).map((achievement) => ({
    name: achievement,
    unlockTime: Date.now(),
  }));

export const processSteamCacheAchievement = (input: unknown): UnlockedAchievement[] => {
  const blocks = Array.isArray(input)
    ? input.filter((entry) => Array.isArray(entry) && entry[0] === "achievements").map((entry) => entry[1])
    : input && typeof input === "object" ? [(input as Record<string, unknown>).achievements] : [];
  const result = new Map<string, UnlockedAchievement>();
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const record = block as Record<string, unknown>;
    const data = (record.data ?? record) as Record<string, unknown>;
    for (const list of [data.vecHighlight, data.vecAchieved, data.vecAchievements]) {
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        if (!entry || !isExplicitAchievementUnlock(entry.bAchieved) ||
            typeof entry.strID !== "string" || !entry.strID.trim()) continue;
        const time = Number(entry.rtUnlocked);
        const unlockTime = Number.isFinite(time) && time > 0 ? (time >= 1e12 ? time : time * 1000) : 0;
        const key = entry.strID.toLowerCase();
        const previous = result.get(key);
        if (!previous || (!previous.unlockTime && unlockTime)) result.set(key, { name: entry.strID, unlockTime });
      }
    }
  }
  return [...result.values()];
};

const ACHIEVEMENT_PARSERS: Partial<
  Record<Cracker, (filePath: string) => UnlockedAchievement[]>
> = {
  [Cracker.codex]: (filePath) => processDefault(iniParse(filePath)),
  [Cracker.rune]: (filePath) => processDefault(iniParse(filePath)),
  [Cracker.onlineFix]: (filePath) => processOnlineFix(iniParse(filePath)),
  [Cracker.goldberg]: (filePath) => processGoldberg(jsonParse(filePath)),
  [Cracker.userstats]: (filePath) => processUserStats(iniParse(filePath)),
  [Cracker.rld]: (filePath) => processRld(iniParse(filePath)),
  [Cracker.skidrow]: (filePath) => processSkidrow(iniParse(filePath)),
  [Cracker._3dm]: (filePath) => process3DM(iniParse(filePath)),
  [Cracker.ali213]: (filePath) =>
    processDefault(iniParse(filePath), "HaveAchieved", "HaveAchievedTime"),
  [Cracker.flt]: processFltFolder,
  [Cracker.creamAPI]: (filePath) => processCreamAPI(iniParse(filePath)),
  [Cracker.empress]: (filePath) => processGoldberg(jsonParse(filePath)),
  [Cracker.razor1911]: processRazor1911,
  [Cracker.Steam]: (filePath) =>
    processSteamCacheAchievement(jsonParse(filePath)),
};

export const parseAchievementFile = (
  filePath: string,
  type: Cracker
): UnlockedAchievement[] => {
  if (!existsSync(filePath)) return [];

  const parseAchievements = ACHIEVEMENT_PARSERS[type];

  if (!parseAchievements) {
    achievementsLogger.log(
      `Unprocessed ${type} achievements found on ${filePath}`
    );
    return [];
  }

  try {
    return parseAchievements(filePath).filter((achievement) =>
      Boolean(achievement.name?.trim())
    );
  } catch (err) {
    achievementsLogger.error(`Error parsing ${type} - ${filePath}`, err);
    return [];
  }
};
