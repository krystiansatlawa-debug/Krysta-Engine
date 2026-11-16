import { registerEvent } from "../register-event";

export const restartAndInstallUpdate = () => {
  // Legacy Hydra installation IPC is intentionally disabled.
};

registerEvent("restartAndInstallUpdate", async () => restartAndInstallUpdate());
