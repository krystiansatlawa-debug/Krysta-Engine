import path from "node:path";
import { app } from "electron";
import { db } from "@main/level";

import { resolveAchievementScreenshotsDirectory } from "../achievement-screenshots-directory-path";
import { SystemPath } from "../system-path";
import { readUserPreferences } from "./screenshot-user-preferences";

const SCREENSHOTS_FOLDER_NAME = "Hydra";
const KRYSTA_SCREENSHOTS_FOLDER_NAME = "Krysta";
const privateAlbums = db.sublevel<string, string>("krysta-private-screenshot-folders", { valueEncoding: "json" });

export const getPrivateScreenshotsFolder = () => privateAlbums.get("source");
export const setPrivateScreenshotsFolder = (folder: string) => privateAlbums.put("source", folder);

const getPicturesDirectory = () => {
  try {
    return app.getPath("pictures");
  } catch {
    return path.join(SystemPath.getPath("home"), "Pictures");
  }
};

export const getDefaultScreenshotsFolder = () =>
  path.join(getPicturesDirectory(), SCREENSHOTS_FOLDER_NAME);

export const getScreenshotsFolder = async () => {
  const userPreferences = await readUserPreferences();

  return resolveAchievementScreenshotsDirectory(
    userPreferences?.screenshotsFolderPath,
    getDefaultScreenshotsFolder()
  );
};

export const getScreenshotFolderCandidates = async () => [
  ...new Set([
    await getPrivateScreenshotsFolder(),
    await getScreenshotsFolder(),
    getDefaultScreenshotsFolder(),
    path.join(getPicturesDirectory(), KRYSTA_SCREENSHOTS_FOLDER_NAME),
    path.join(SystemPath.getPath("home"), "Pictures", SCREENSHOTS_FOLDER_NAME),
    path.join(
      SystemPath.getPath("home"),
      "Pictures",
      KRYSTA_SCREENSHOTS_FOLDER_NAME
    ),
  ].filter((value): value is string => Boolean(value))),
];
