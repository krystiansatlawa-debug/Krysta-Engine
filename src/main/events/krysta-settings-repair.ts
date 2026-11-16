import { app, ipcMain } from "electron";
import { repairKrystaSettings } from "@main/services/krysta-settings-recovery";

let last:Awaited<ReturnType<typeof repairKrystaSettings>>|null=null;
export async function runKrystaSettingsRepair(){
 last=await repairKrystaSettings(app.getPath("userData"));
 return last;
}
ipcMain.handle("krysta:settings-repair",runKrystaSettingsRepair);
ipcMain.handle("krysta:settings-repair-status",()=>last);
