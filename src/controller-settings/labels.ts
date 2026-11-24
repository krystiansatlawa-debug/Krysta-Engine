import { useTranslation } from "react-i18next";
import {
  controllerDesktopBindings,
  type ControllerDesktopBinding,
} from "../shared/controller-desktop";

const textKeys = [
  "title",
  "windows",
  "windowsDescription",
  "module",
  "keyboard",
  "preferredController",
  "windowsProfile",
  "useProfile",
  "noWindowsPad",
  "refreshDevices",
  "profile",
  "preferredBrowserPad",
  "noBrowserPad",
  "vibration",
  "testVibration",
  "legacyCursor",
  "automatic",
  "disconnected",
  "cursorSpeed",
  "deadZone",
  "mapping",
  "chooseButton",
  "legacyMapping",
  "action",
  "unassigned",
  "restore",
  "decrease",
  "increase",
  "displays",
  "preferredDisplay",
  "tv",
  "restoreDisplay",
  "hdmi",
  "enableForDisplays",
  "singleDisplay",
  "duplicate",
  "extend",
  "loading",
  "readError",
  "saveError",
  "displayError",
  "displayChanged",
  "button",
] as const;

export function useControllerSettingsLabels() {
  const { t } = useTranslation("settings");
  const text = Object.fromEntries(
    textKeys.map((key) => [key, t(`controller_configuration.${key}`)])
  ) as Record<(typeof textKeys)[number], string>;
  const bindings = Object.fromEntries(
    Object.keys(controllerDesktopBindings).map((key) => [
      key,
      t(`controller_configuration.bindings.${key}`),
    ])
  ) as Record<ControllerDesktopBinding, string>;

  return { text, bindings };
}
