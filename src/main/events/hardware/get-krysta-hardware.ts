import os from "node:os";
import { registerEvent } from "../register-event";
registerEvent("getKrystaHardware", async () => ({
  ramBytes: os.totalmem(),
  cpu: os.cpus()[0]?.model ?? "",
  logicalCores: os.cpus().length,
}));
