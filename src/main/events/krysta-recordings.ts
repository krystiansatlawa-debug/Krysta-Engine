import { ipcMain } from "electron";
import {
  recordingState,
  setRecordingSettings,
  openRecording,
  deleteRecording,
  openRecordingsFolder,
  stopRecording,
  readRecording,
  chooseRecordingFolder,
  saveTrimmedRecording,
} from "@main/services/krysta-recordings";
ipcMain.handle("krysta:recordings-state", () => recordingState());
ipcMain.handle("krysta:recordings-settings", (_e, value: unknown) =>
  setRecordingSettings(value)
);
ipcMain.handle("krysta:recording-open", (_e, id: unknown) => openRecording(id));
ipcMain.handle("krysta:recording-delete", (_e, id: unknown) =>
  deleteRecording(id)
);
ipcMain.handle("krysta:recordings-folder", () => openRecordingsFolder());
ipcMain.handle("krysta:recording-stop", () => stopRecording());
ipcMain.handle("krysta:recording-read", (_e, id: unknown) => readRecording(id));
ipcMain.handle("krysta:recordings-choose-folder", (_e, reset: unknown) =>
  chooseRecordingFolder(reset === true)
);
ipcMain.handle(
  "krysta:recording-trim-save",
  (
    _e,
    id: unknown,
    start: unknown,
    end: unknown,
    data: unknown,
    duration: unknown,
    audio: unknown
  ) => saveTrimmedRecording(id, start, end, data, duration, audio)
);
