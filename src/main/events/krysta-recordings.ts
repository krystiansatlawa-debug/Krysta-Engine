import { ipcMain } from "electron";
import { recordingState, setRecordingSettings, openRecording, deleteRecording, openRecordingsFolder, stopRecording } from "@main/services/krysta-recordings";
ipcMain.handle("krysta:recordings-state",()=>recordingState());
ipcMain.handle("krysta:recordings-settings",(_e,value:unknown)=>setRecordingSettings(value));
ipcMain.handle("krysta:recording-open",(_e,id:unknown)=>openRecording(id));
ipcMain.handle("krysta:recording-delete",(_e,id:unknown)=>deleteRecording(id));
ipcMain.handle("krysta:recordings-folder",()=>openRecordingsFolder());
ipcMain.handle("krysta:recording-stop",()=>stopRecording());
