import type { GameStoryProgress } from "@types";

export const STORY_MISSION_NAME_LIMIT = 160;
export const STORY_MISSION_DESCRIPTION_LIMIT = 500;

export function normalizeGameStoryProgress(
  input: unknown
): GameStoryProgress | null {
  if (!input || typeof input !== "object")
    throw new Error("Invalid story progress");

  const { percent, missionName, missionDescription } =
    input as Partial<GameStoryProgress>;
  if (
    (percent !== null &&
      (typeof percent !== "number" ||
        !Number.isFinite(percent) ||
        percent < 0 ||
        percent > 100)) ||
    typeof missionName !== "string" ||
    missionName.length > STORY_MISSION_NAME_LIMIT ||
    typeof missionDescription !== "string" ||
    missionDescription.length > STORY_MISSION_DESCRIPTION_LIMIT
  ) {
    throw new Error("Invalid story progress");
  }

  const title = missionName.trim();
  const description = missionDescription.trim();
  if (percent === null && !title && !description) return null;

  return { percent, missionName: title, missionDescription: description };
}
