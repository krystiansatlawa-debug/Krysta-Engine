import { Button, CheckboxField, SelectField } from "@renderer/components";
import {
  ControllerSettingsPanel,
  type ControllerButtonProps,
  type ControllerCheckboxProps,
  type ControllerGridProps,
  type ControllerSelectProps,
  type ControllerSettingsControls,
} from "../../../../controller-settings/controller-settings-panel";

const controls: ControllerSettingsControls = {
  Button: ({
    id,
    disabled,
    children,
    onClick,
    pressed,
    label,
  }: Readonly<ControllerButtonProps>) => (
    <Button
      id={id}
      theme="outline"
      size="small"
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </Button>
  ),
  Select: ({
    label,
    value,
    options,
    disabled,
    onChange,
  }: Readonly<ControllerSelectProps>) => (
    <SelectField
      label={label}
      value={value}
      options={options.map((option) => ({ ...option, key: option.value }))}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
  Checkbox: ({
    id,
    label,
    checked,
    disabled,
    onChange,
  }: Readonly<ControllerCheckboxProps>) => (
    <CheckboxField
      id={id}
      label={label}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
  ),
  Grid: ({ children, className }: Readonly<ControllerGridProps>) => (
    <div className={className}>{children}</div>
  ),
};

export function SettingsContextControllers() {
  return (
    <div className="settings-context-panel">
      <ControllerSettingsPanel controls={controls} />
    </div>
  );
}
