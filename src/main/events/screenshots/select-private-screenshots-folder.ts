import fs from "node:fs/promises";
import path from "node:path";
import { dialog, ipcMain } from "electron";
import { importSelectedPrivateScreenshots } from "@main/services/screenshots";
import { setPrivateScreenshotsFolder } from "@main/services/screenshots/screenshots-folder";

ipcMain.handle("krysta:select-private-screenshots-folder", async () => {
  const selection = await dialog.showOpenDialog({
    title: "Krysta – dodaj prywatny folder zdjęć",
    properties: ["openDirectory"],
  });
  if (selection.canceled || !selection.filePaths[0]) return null;
  const selected = selection.filePaths[0];
  if (!path.isAbsolute(selected)) throw Error("Invalid folder");
  const info = await fs.lstat(selected);
  if (!info.isDirectory() || info.isSymbolicLink()) throw Error("Invalid folder");
  const folder = await fs.realpath(selected);
  await setPrivateScreenshotsFolder(folder);
  return { imported: await importSelectedPrivateScreenshots() };
});
