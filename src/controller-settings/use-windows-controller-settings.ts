import { useCallback, useEffect, useRef, useState } from "react";

import type {
  WindowsDesktopControllerDevice,
  WindowsDesktopControllerSettings,
} from "../shared/controller-desktop";
import type {
  ControllerDisplay,
  ControllerDisplayMode,
  ControllerDisplaySettings,
} from "../shared/controller-display";

type Status =
  | "readError"
  | "saveError"
  | "displayError"
  | "displayChanged"
  | null;

export function useWindowsControllerSettings() {
  const electron = globalThis.window?.electron;
  const available = electron?.platform === "win32";
  const [input, setInput] = useState<WindowsDesktopControllerSettings>();
  const [output, setOutput] = useState<ControllerDisplaySettings>();
  const [devices, setDevices] = useState<WindowsDesktopControllerDevice[]>([]);
  const [displays, setDisplays] = useState<ControllerDisplay[]>([]);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const operationPending = useRef(false);

  const pendingDevices = useRef(false);
  const readDevices = useCallback(async () => {
    if (!available || pendingDevices.current || document.hidden) return;
    pendingDevices.current = true;
    try {
      const next = await electron.getDesktopControllerDevices();
      setDevices((current) =>
        current.length === next.length &&
        current.every((device, index) => device.id === next[index].id)
          ? current
          : next
      );
    } catch {
      setStatus("readError");
    } finally {
      pendingDevices.current = false;
    }
  }, [available, electron]);

  useEffect(() => {
    if (!available) return;
    let active = true;

    const readInput = async () => {
      try {
        const next = await electron.getDesktopControllerSettings();
        if (active) setInput(next);
      } catch {
        if (active) setStatus("readError");
      }
    };

    const readOutput = async () => {
      try {
        const next = await electron.getControllerDisplaySettings();
        if (active) setOutput(next);
      } catch {
        if (active) setStatus("readError");
      }
    };

    const readDisplays = async () => {
      try {
        const next = await electron.getWindowsControllerDisplays();
        if (active) setDisplays(next);
      } catch {
        if (active) setStatus("readError");
      }
    };

    const removeInput = electron.onDesktopControllerSettingsChanged?.(
      (next) => {
        if (active) setInput(next);
      }
    );
    const removeOutput = electron.onControllerDisplaySettingsChange?.(
      (next) => {
        if (active) setOutput(next);
      }
    );
    const removeDisplays = electron.onControllerDisplaysChange?.(
      () => void readDisplays()
    );

    const refresh = () => {
      if (document.hidden) return;
      void readDevices();
      void readInput();
      void readOutput();
      void readDisplays();
    };
    refresh();
    document.addEventListener("visibilitychange", refresh);

    return () => {
      active = false;
      document.removeEventListener("visibilitychange", refresh);
      removeInput?.();
      removeOutput?.();
      removeDisplays?.();
    };
  }, [available, electron, readDevices]);

  useEffect(() => {
    if (!input?.enabled) return;
    void readDevices();
    const timer = window.setInterval(() => void readDevices(), 2500);
    return () => window.clearInterval(timer);
  }, [input?.enabled, readDevices]);

  const run = async (
    operation: () => Promise<void>,
    error: Exclude<Status, null>
  ) => {
    if (operationPending.current) return;
    operationPending.current = true;
    setBusy(true);
    setStatus(null);
    try {
      await operation();
    } catch {
      setStatus(error);
    } finally {
      operationPending.current = false;
      setBusy(false);
    }
  };

  const updateInput = (patch: Partial<WindowsDesktopControllerSettings>) =>
    run(async () => {
      setInput(await electron.updateDesktopControllerSettings(patch));
    }, "saveError");

  const updateOutput = (patch: Partial<ControllerDisplaySettings>) =>
    run(async () => {
      setOutput(await electron.setControllerDisplaySettings(patch));
    }, "saveError");

  const setDisplayMode = (mode: ControllerDisplayMode, id?: string) =>
    run(async () => {
      const changed = await electron.setControllerDisplayMode(mode, id);
      setStatus(changed ? "displayChanged" : "displayError");
    }, "displayError");

  return {
    available,
    input,
    output,
    devices,
    displays,
    status,
    busy,
    readDevices,
    updateInput,
    updateOutput,
    setDisplayMode,
  };
}
