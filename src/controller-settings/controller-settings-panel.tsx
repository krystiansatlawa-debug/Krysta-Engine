import {
  type ComponentType,
  type CSSProperties,
  type ReactNode,
  useEffect,
  useState,
} from "react";

import {
  getBrowserControllerProfile,
  useGamepadStore,
} from "../big-picture/src/stores/gamepad.store";
import {
  controllerDesktopBindings,
  defaultWindowsControllerProfile,
  getControllerBinding,
  setControllerBinding,
  type ControllerDesktopBinding,
  type ControllerProfile,
} from "../shared/controller-desktop";
import { useControllerSettingsLabels } from "./labels";
import { useWindowsControllerSettings } from "./use-windows-controller-settings";

import "./controller-settings.scss";

export interface ControllerSelectOption {
  value: string;
  label: string;
}

interface ControlProps {
  id: string;
  disabled?: boolean;
}

export interface ControllerButtonProps extends ControlProps {
  children: ReactNode;
  onClick: () => void;
  pressed?: boolean;
  label?: string;
}

export interface ControllerSelectProps extends ControlProps {
  label: string;
  value: string;
  options: ControllerSelectOption[];
  onChange: (value: string) => void;
}

export interface ControllerCheckboxProps extends ControlProps {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}

export interface ControllerGridProps {
  children: ReactNode;
  className: string;
}

export interface ControllerSettingsControls {
  Button: ComponentType<ControllerButtonProps>;
  Select: ComponentType<ControllerSelectProps>;
  Checkbox: ComponentType<ControllerCheckboxProps>;
  Grid: ComponentType<ControllerGridProps>;
}

type Labels = ReturnType<typeof useControllerSettingsLabels>;

const WINDOWS_BINDINGS = Object.keys(
  controllerDesktopBindings
) as ControllerDesktopBinding[];
const BIG_PICTURE_BINDINGS: ControllerDesktopBinding[] = [
  "left",
  "right",
  "doubleClick",
  "switchWindow",
  "volumeDown",
  "volumeUp",
  "minimize",
  "maximize",
];

const XBOX_BUTTONS = [
  "A",
  "B",
  "X",
  "Y",
  "LB",
  "RB",
  "LT",
  "RT",
  "View",
  "Menu",
  "L3",
  "R3",
  "↑",
  "↓",
  "←",
  "→",
  "Xbox",
];
const DUALSENSE_BUTTONS = [
  "✕",
  "○",
  "□",
  "△",
  "L1",
  "R1",
  "L2",
  "R2",
  "Create",
  "Options",
  "L3",
  "R3",
  "↑",
  "↓",
  "←",
  "→",
  "PS",
  "Touchpad",
  "Mute",
];
const BUTTON_POSITIONS = [
  [5, 6],
  [4, 7],
  [4, 5],
  [3, 6],
  [2, 1],
  [2, 7],
  [1, 1],
  [1, 7],
  [3, 3],
  [3, 5],
  [6, 2],
  [6, 6],
  [3, 2],
  [5, 2],
  [4, 1],
  [4, 3],
  [3, 4],
  [4, 4],
  [5, 4],
];

function controllerLabel(
  index: number,
  layout: string,
  fallback: string
): string {
  const sony = /dualsense|dualshock|playstation/i.test(layout);
  return (
    (sony ? DUALSENSE_BUTTONS : XBOX_BUTTONS)[index] ??
    `${fallback} ${index + 1}`
  );
}

function ButtonMap({
  id,
  layout,
  count,
  profile,
  actions,
  disabled,
  labels,
  controls,
  onChange,
}: Readonly<{
  id: string;
  layout: string;
  count: number;
  profile: ControllerProfile;
  actions: ControllerDesktopBinding[];
  disabled?: boolean;
  labels: Labels;
  controls: ControllerSettingsControls;
  onChange: (bindings: ControllerProfile["bindings"]) => void;
}>) {
  const [selected, setSelected] = useState(0);
  const selectedIndex = selected < count ? selected : 0;
  const { Button, Grid, Select } = controls;
  const { bindings, text } = labels;
  const assignedAction = actions.find(
    (action) => getControllerBinding(profile, action) === selectedIndex
  );

  const changeAction = (value: string) => {
    const action = actions.find((candidate) => candidate === value);
    if (action) {
      onChange(
        setControllerBinding(profile, action, selectedIndex, actions).bindings
      );
    } else if (assignedAction) {
      onChange(
        setControllerBinding(profile, assignedAction, -1, actions).bindings
      );
    }
  };

  if (!count) return null;

  return (
    <div className="controller-settings__button-map">
      <Grid className="controller-settings__board">
        {Array.from({ length: count }, (_, index) => {
          const [row, column] = BUTTON_POSITIONS[index] ?? [
            7 + Math.floor((index - 19) / 7),
            1 + ((index - 19) % 7),
          ];
          const key = controllerLabel(index, layout, text.button);
          const action = actions.find(
            (name) => getControllerBinding(profile, name) === index
          );
          const actionLabel = action ? bindings[action] : text.unassigned;
          return (
            <div
              key={index}
              className="controller-settings__key"
              style={
                { gridRow: row, gridColumn: column } satisfies CSSProperties
              }
              title={`${key} · ${actionLabel}`}
            >
              <Button
                id={`${id}-key-${index}`}
                disabled={disabled}
                pressed={index === selectedIndex}
                label={`${key} · ${actionLabel}`}
                onClick={() => setSelected(index)}
              >
                {key}
              </Button>
            </div>
          );
        })}
      </Grid>
      <Select
        id={`${id}-action`}
        label={`${text.action} ${controllerLabel(selectedIndex, layout, text.button)}`}
        value={assignedAction ?? ""}
        options={[
          { value: "", label: text.unassigned },
          ...actions.map((value) => ({ value, label: bindings[value] })),
        ]}
        disabled={disabled}
        onChange={changeAction}
      />
    </div>
  );
}

function ProfileNumber({
  id,
  label,
  displayValue,
  value,
  min,
  max,
  step,
  onChange,
  disabled,
  controls,
  text,
}: Readonly<{
  id: string;
  label: string;
  displayValue: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  controls: ControllerSettingsControls;
  text: Labels["text"];
}>) {
  const { Button, Grid } = controls;
  return (
    <div className="controller-settings__number">
      <span>{label}</span>
      <Grid className="controller-settings__stepper">
        <Button
          id={`${id}-less`}
          label={`${text.decrease} · ${label}`}
          disabled={disabled || value <= min}
          onClick={() => onChange(Math.max(min, value - step))}
        >
          −
        </Button>
        <output aria-label={label}>{displayValue}</output>
        <Button
          id={`${id}-more`}
          label={`${text.increase} · ${label}`}
          disabled={disabled || value >= max}
          onClick={() => onChange(Math.min(max, value + step))}
        >
          +
        </Button>
      </Grid>
    </div>
  );
}

function PointerProfileSettings({
  id,
  profile,
  layout,
  buttonCount,
  legacy = false,
  disabled,
  onChange,
  labels,
  controls,
}: Readonly<{
  id: string;
  profile: ControllerProfile;
  layout: string;
  buttonCount: number;
  legacy?: boolean;
  disabled?: boolean;
  onChange: (patch: Partial<ControllerProfile>) => void;
  labels: Labels;
  controls: ControllerSettingsControls;
}>) {
  const { text } = labels;
  const deadZonePercent = Math.round(profile.deadZone * 100);
  return (
    <>
      <ProfileNumber
        id={`${id}-speed`}
        label={text.cursorSpeed}
        displayValue={String(profile.cursorSpeed)}
        value={profile.cursorSpeed}
        min={1}
        max={40}
        step={1}
        onChange={(cursorSpeed) => onChange({ cursorSpeed })}
        disabled={disabled}
        controls={controls}
        text={text}
      />
      <ProfileNumber
        id={`${id}-dead-zone`}
        label={text.deadZone}
        displayValue={`${deadZonePercent}%`}
        value={deadZonePercent}
        min={0}
        max={90}
        step={1}
        onChange={(value) => onChange({ deadZone: value / 100 })}
        disabled={disabled}
        controls={controls}
        text={text}
      />
      <h4>{legacy ? text.legacyMapping : text.mapping}</h4>
      <p>{text.chooseButton}</p>
      <ButtonMap
        id={`${id}-map`}
        layout={layout}
        count={Math.min(buttonCount, 32)}
        profile={profile}
        actions={legacy ? BIG_PICTURE_BINDINGS : WINDOWS_BINDINGS}
        disabled={disabled}
        labels={labels}
        controls={controls}
        onChange={(bindings) => onChange({ bindings })}
      />
    </>
  );
}

function WindowsControllerSettings({
  labels,
  controls,
}: Readonly<{ labels: Labels; controls: ControllerSettingsControls }>) {
  const {
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
  } = useWindowsControllerSettings();
  const [selectedProfileId, setSelectedProfileId] = useState<string>();
  const { text } = labels;
  const { Button, Checkbox, Select } = controls;

  if (!available) return null;

  const preferredDevice = devices.find(
    (device) => device.id === input?.preferredDeviceId
  );
  const deviceOptions = devices.map((device, index) => ({
    value: device.id,
    label: `${device.name} (${index + 1})`,
  }));
  const selectedDevice =
    devices.find((device) => device.id === selectedProfileId) ??
    preferredDevice ??
    devices[0];
  const profile =
    input && selectedDevice
      ? (input.profiles[selectedDevice.id] ?? defaultWindowsControllerProfile())
      : undefined;

  const saveProfile = (next: ControllerProfile) => {
    if (selectedDevice)
      void updateInput({ profiles: { [selectedDevice.id]: next } });
  };

  const preferredDisplay = displays.find(
    (display) => display.id === output?.preferredDisplayId
  );
  const displayOptions = displays.map((display) => ({
    value: display.id,
    label: display.label,
  }));

  return (
    <>
      <section className="controller-settings__group" aria-busy={busy}>
        <h3>{text.windows}</h3>
        <p>{text.windowsDescription}</p>
        {input ? (
          <>
            <Checkbox
              id="controller-windows-enabled"
              label={text.module}
              checked={input.enabled}
              onChange={(enabled) => void updateInput({ enabled })}
            />
            <Checkbox
              id="controller-windows-keyboard"
              label={text.keyboard}
              checked={input.autoShowKeyboard}
              onChange={(autoShowKeyboard) =>
                void updateInput({ autoShowKeyboard })
              }
            />
            <Select
              id="controller-windows-preferred"
              label={text.preferredController}
              value={input.preferredDeviceId ?? ""}
              options={[
                { value: "", label: text.automatic },
                ...deviceOptions,
                ...(input.preferredDeviceId && !preferredDevice
                  ? [
                      {
                        value: input.preferredDeviceId,
                        label: text.disconnected,
                      },
                    ]
                  : []),
              ]}
              disabled={!devices.length && !input.preferredDeviceId}
              onChange={(value) => {
                setSelectedProfileId(value || undefined);
                void updateInput({ preferredDeviceId: value || null });
              }}
            />
            {selectedDevice && profile ? (
              <>
                <Select
                  id="controller-windows-profile"
                  label={text.windowsProfile}
                  value={selectedDevice.id}
                  options={deviceOptions}
                  disabled={devices.length < 2}
                  onChange={setSelectedProfileId}
                />
                <Checkbox
                  id="controller-windows-profile-enabled"
                  label={text.useProfile}
                  checked={profile.enabled}
                  onChange={(enabled) => saveProfile({ ...profile, enabled })}
                />
                <PointerProfileSettings
                  key={selectedDevice.id}
                  id="controller-windows"
                  profile={profile}
                  layout={selectedDevice.layout}
                  buttonCount={selectedDevice.layout === "dualsense" ? 19 : 16}
                  onChange={(patch) => saveProfile({ ...profile, ...patch })}
                  controls={controls}
                  labels={labels}
                />
                <Button
                  id="controller-windows-reset"
                  onClick={() => saveProfile(defaultWindowsControllerProfile())}
                >
                  {text.restore}
                </Button>
              </>
            ) : (
              <p>{text.noWindowsPad}</p>
            )}
            {!input.enabled && (
              <Button
                id="controller-windows-device-refresh"
                onClick={() => void readDevices()}
              >
                {text.refreshDevices}
              </Button>
            )}
          </>
        ) : (
          !status && <p>{text.loading}</p>
        )}
      </section>
      {output && (
        <section className="controller-settings__group" aria-busy={busy}>
          <h3>{text.displays}</h3>
          <Select
            id="controller-preferred-display"
            label={text.preferredDisplay}
            value={output.preferredDisplayId ?? ""}
            options={[
              { value: "", label: text.automatic },
              ...displayOptions,
              ...(output.preferredDisplayId && !preferredDisplay
                ? [
                    {
                      value: output.preferredDisplayId,
                      label: text.disconnected,
                    },
                  ]
                : []),
            ]}
            disabled={!displays.length && !output.preferredDisplayId}
            onChange={(value) =>
              void updateOutput({ preferredDisplayId: value || null })
            }
          />
          <Checkbox
            id="controller-switch-tv"
            label={text.tv}
            checked={output.autoSwitchToTv}
            onChange={(autoSwitchToTv) => void updateOutput({ autoSwitchToTv })}
          />
          <Checkbox
            id="controller-restore-display"
            label={text.restoreDisplay}
            checked={output.restoreDisplayAfterGame}
            onChange={(restoreDisplayAfterGame) =>
              void updateOutput({ restoreDisplayAfterGame })
            }
          />
          <Checkbox
            id="controller-hdmi-audio"
            label={text.hdmi}
            checked={output.switchHdmiAudio}
            onChange={(switchHdmiAudio) =>
              void updateOutput({ switchHdmiAudio })
            }
          />
          {!input?.enabled && <p>{text.enableForDisplays}</p>}
          <div className="controller-settings__actions">
            <Button
              id="controller-mode-single"
              disabled={!input?.enabled || !preferredDisplay}
              onClick={() =>
                void setDisplayMode("display", preferredDisplay?.id)
              }
            >
              {text.singleDisplay}
            </Button>
            <Button
              id="controller-mode-duplicate"
              disabled={!input?.enabled || displays.length < 2}
              onClick={() => void setDisplayMode("duplicate")}
            >
              {text.duplicate}
            </Button>
            <Button
              id="controller-mode-extend"
              disabled={!input?.enabled || displays.length < 2}
              onClick={() => void setDisplayMode("extend")}
            >
              {text.extend}
            </Button>
          </div>
        </section>
      )}
      {status && <p role="status">{text[status]}</p>}
    </>
  );
}

function BigPictureControllerSettings({
  controls,
  labels,
}: Readonly<{ labels: Labels; controls: ControllerSettingsControls }>) {
  const connectedPads = useGamepadStore((state) => state.connectedGamepads);
  const activeIndex = useGamepadStore((state) => state.activeGamepadIndex);
  const preferredIndex = useGamepadStore(
    (state) => state.preferredGamepadIndex
  );
  const profiles = useGamepadStore((state) => state.profiles);
  const sync = useGamepadStore((state) => state.sync);
  const selectPad = useGamepadStore((state) => state.selectGamepad);
  const updateProfile = useGamepadStore((state) => state.updateProfile);
  const resetProfile = useGamepadStore((state) => state.resetProfile);
  const pad =
    connectedPads.find((device) => device.index === activeIndex) ??
    connectedPads[0];
  const profile = getBrowserControllerProfile(profiles, pad ?? null);
  const { Button, Checkbox, Select } = controls;
  const { text } = labels;
  const supportsCursor = globalThis.window?.electron?.platform === "win32";

  useEffect(() => sync(), [sync]);

  return (
    <section className="controller-settings__group">
      <h3>{text.profile}</h3>
      <Select
        id="controller-browser-preferred"
        label={text.preferredBrowserPad}
        value={preferredIndex?.toString() ?? ""}
        options={[
          { value: "", label: text.automatic },
          ...connectedPads.map((device) => ({
            value: String(device.index),
            label: `${device.name} (${device.index + 1})`,
          })),
        ]}
        onChange={(value) => selectPad(value === "" ? null : Number(value))}
      />
      {pad ? (
        <>
          <Checkbox
            id="controller-browser-vibration"
            label={text.vibration}
            checked={profile.vibration}
            onChange={(vibration) => updateProfile(pad, { vibration })}
          />
          {supportsCursor && (
            <>
              <Checkbox
                id="controller-browser-cursor"
                label={text.legacyCursor}
                checked={profile.enabled}
                onChange={(enabled) => updateProfile(pad, { enabled })}
              />
              <PointerProfileSettings
                key={pad.index}
                id="controller-browser"
                profile={profile}
                layout={`${pad.name} ${pad.layout}`}
                buttonCount={pad.buttonCount}
                legacy
                onChange={(patch) => updateProfile(pad, patch)}
                controls={controls}
                labels={labels}
              />
            </>
          )}
          <div className="controller-settings__actions">
            <Button
              id="controller-browser-reset"
              onClick={() => resetProfile(pad)}
            >
              {text.restore}
            </Button>
            <Button
              id="controller-browser-test-vibration"
              disabled={!profile.vibration}
              onClick={() =>
                useGamepadStore
                  .getState()
                  .getService()
                  .vibrate(180, 0.4, 0.4, pad.index)
              }
            >
              {text.testVibration}
            </Button>
          </div>
        </>
      ) : (
        <p>{text.noBrowserPad}</p>
      )}
    </section>
  );
}

export function ControllerSettingsPanel({
  controls,
}: Readonly<{ controls: ControllerSettingsControls }>) {
  const labels = useControllerSettingsLabels();
  return (
    <div className="controller-settings">
      <WindowsControllerSettings labels={labels} controls={controls} />
      <BigPictureControllerSettings labels={labels} controls={controls} />
    </div>
  );
}
