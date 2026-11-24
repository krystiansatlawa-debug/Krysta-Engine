import { readFileSync } from "node:fs";

import type { UnlockedAchievement } from "@types";

const BYTE_ORDER_MARK = 0xfeff;
const MICROSECOND_TIMESTAMP_LENGTH = 7;

const UNLOCKED_PATTERN = /\bunlocked\s*=\s*true\b/i;
const UNLOCK_TIME_PATTERN = /(?:^|[{,\s])time\s*=\s*(\d+)/i;

const readFileLines = (filePath: string) => {
  const fileContent = readFileSync(filePath, "utf-8");

  const withoutByteOrderMark =
    fileContent.codePointAt(0) === BYTE_ORDER_MARK
      ? fileContent.slice(1)
      : fileContent;

  return withoutByteOrderMark.split(/[\r\n]+/);
};

const parseUnlockTime = (unlockTime: string | number) =>
  typeof unlockTime === "string" &&
  unlockTime.length === MICROSECOND_TIMESTAMP_LENGTH
    ? Number(unlockTime) * 1000 * 1000
    : Number(unlockTime) * 1000;

export const iniParse = (filePath: string) => {
  const lines = readFileLines(filePath);

  let objectName = "";
  const object: Record<string, Record<string, string | number>> = {};

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (
      !trimmedLine.length ||
      trimmedLine.startsWith("#") ||
      trimmedLine.startsWith(";")
    ) {
      continue;
    }

    if (trimmedLine.startsWith("[") && trimmedLine.endsWith("]")) {
      objectName = trimmedLine.slice(1, -1);
      object[objectName] = {};
      continue;
    }

    object[objectName] ??= {};

    const [name, ...value] = trimmedLine.split("=");
    object[objectName][name.trim()] = value.join("=").trim();
  }

  return object;
};

export const jsonParse = (filePath: string) => {
  return JSON.parse(readFileSync(filePath, "utf-8").replace(/^\uFEFF/, ""));
};

export const processRazor1911 = (filePath: string): UnlockedAchievement[] => {
  const lines = readFileLines(filePath);

  const achievements: UnlockedAchievement[] = [];
  for (const line of lines) {
    if (!line.length) continue;

    const [name, unlocked, unlockTime] = line.split(" ");
    if (unlocked === "1") {
      achievements.push({
        name,
        unlockTime: Number(unlockTime) * 1000,
      });
    }
  }

  return achievements;
};

export const processOnlineFix = (
  unlockedAchievements: any
): UnlockedAchievement[] => {
  const parsedUnlockedAchievements: UnlockedAchievement[] = [];

  for (const achievement of Object.keys(unlockedAchievements)) {
    const unlockedAchievement = unlockedAchievements[achievement];

    if (unlockedAchievement?.achieved == "true") {
      parsedUnlockedAchievements.push({
        name: achievement,
        unlockTime: unlockedAchievement.timestamp * 1000,
      });
    } else if (unlockedAchievement?.Achieved == "true") {
      parsedUnlockedAchievements.push({
        name: achievement,
        unlockTime: parseUnlockTime(unlockedAchievement.TimeUnlocked),
      });
    }
  }

  return parsedUnlockedAchievements;
};

export const processCreamAPI = (
  unlockedAchievements: any
): UnlockedAchievement[] => {
  const parsedUnlockedAchievements: UnlockedAchievement[] = [];

  for (const achievement of Object.keys(unlockedAchievements)) {
    const unlockedAchievement = unlockedAchievements[achievement];

    if (unlockedAchievement?.achieved == "true") {
      parsedUnlockedAchievements.push({
        name: achievement,
        unlockTime: parseUnlockTime(unlockedAchievement.unlocktime),
      });
    }
  }

  return parsedUnlockedAchievements;
};

export const processSkidrow = (
  unlockedAchievements: any
): UnlockedAchievement[] => {
  const parsedUnlockedAchievements: UnlockedAchievement[] = [];
  const achievements = unlockedAchievements["Achievements"];

  for (const achievement of Object.keys(achievements)) {
    const unlockedAchievement = achievements[achievement].split("@");

    if (unlockedAchievement[0] === "1") {
      parsedUnlockedAchievements.push({
        name: achievement,
        unlockTime: unlockedAchievement[unlockedAchievement.length - 1] * 1000,
      });
    }
  }

  return parsedUnlockedAchievements;
};

export const isExplicitAchievementUnlock = (value: unknown): boolean =>
  value === true || value === 1 ||
  (typeof value === "string" && /^(true|1)$/i.test(value.trim()));

export const processGoldberg = (data: unknown): UnlockedAchievement[] => {
  if (!data || typeof data !== "object") return [];
  const entries = Array.isArray(data)
    ? data.map((entry) => [undefined, entry] as const)
    : Object.entries(data);
  const result: UnlockedAchievement[] = [];
  for (const [key, entry] of entries) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (!isExplicitAchievementUnlock(record.earned ?? record.unlocked ?? record.achieved)) continue;
    const name = key ?? record.name ?? record.id;
    const raw = record.earned_time ?? record.unlockTime ?? record.unlock_time ?? record.timestamp;
    if (typeof name !== "string" || !name.trim()) continue;
    const time = typeof raw === "number" || typeof raw === "string" ? Number(raw) : 0;
    result.push({ name, unlockTime: Number.isFinite(time) && time > 0 ? (time >= 1e12 ? time : time * 1000) : 0 });
  }
  return result;
};

export const process3DM = (
  unlockedAchievements: any
): UnlockedAchievement[] => {
  const newUnlockedAchievements: UnlockedAchievement[] = [];

  const achievements = unlockedAchievements["State"];
  const times = unlockedAchievements["Time"];

  for (const achievement of Object.keys(achievements)) {
    if (achievements[achievement] == "0101") {
      const time = times[achievement];

      newUnlockedAchievements.push({
        name: achievement,
        unlockTime:
          new DataView(
            new Uint8Array(Buffer.from(time.toString(), "hex")).buffer
          ).getUint32(0, true) * 1000,
      });
    }
  }

  return newUnlockedAchievements;
};

export const processDefault = (
  unlockedAchievements: any,
  achievedKey = "Achieved",
  unlockTimeKey = "UnlockTime"
): UnlockedAchievement[] => {
  const newUnlockedAchievements: UnlockedAchievement[] = [];

  for (const achievement of Object.keys(unlockedAchievements)) {
    const unlockedAchievement = unlockedAchievements[achievement];

    if (isExplicitAchievementUnlock(unlockedAchievement?.[achievedKey])) {
      newUnlockedAchievements.push({
        name: achievement,
        unlockTime: unlockedAchievement[unlockTimeKey] * 1000,
      });
    }
  }

  return newUnlockedAchievements;
};

export const processRld = (
  unlockedAchievements: any
): UnlockedAchievement[] => {
  const newUnlockedAchievements: UnlockedAchievement[] = [];

  for (const achievement of Object.keys(unlockedAchievements)) {
    if (achievement === "Steam") continue;

    const unlockedAchievement = unlockedAchievements[achievement];

    if (unlockedAchievement?.State) {
      const unlocked = new DataView(
        new Uint8Array(
          Buffer.from(unlockedAchievement.State.toString(), "hex")
        ).buffer
      ).getUint32(0, true);

      if (unlocked === 1) {
        newUnlockedAchievements.push({
          name: achievement,
          unlockTime:
            new DataView(
              new Uint8Array(
                Buffer.from(unlockedAchievement.Time.toString(), "hex")
              ).buffer
            ).getUint32(0, true) * 1000,
        });
      }
    }
  }

  return newUnlockedAchievements;
};

export const processUserStats = (
  unlockedAchievements: any
): UnlockedAchievement[] => {
  const newUnlockedAchievements: UnlockedAchievement[] = [];

  const achievements = unlockedAchievements["ACHIEVEMENTS"];

  if (!achievements) return [];

  for (const achievement of Object.keys(achievements)) {
    const unlockedAchievement = String(achievements[achievement]);

    if (!UNLOCKED_PATTERN.test(unlockedAchievement)) continue;

    const unlockTimeMatch = UNLOCK_TIME_PATTERN.exec(unlockedAchievement);

    if (!unlockTimeMatch) continue;

    newUnlockedAchievements.push({
      name: achievement.replaceAll(`"`, ``),
      unlockTime: Number(unlockTimeMatch[1]) * 1000,
    });
  }

  return newUnlockedAchievements;
};
