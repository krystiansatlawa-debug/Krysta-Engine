import { useTranslation } from "react-i18next";
import {
  ControllerSettingsPanel,
  type ControllerButtonProps,
  type ControllerCheckboxProps,
  type ControllerSelectProps,
  type ControllerSettingsControls,
} from "../../../../controller-settings/controller-settings-panel";
import {
  Button,
  Checkbox,
  DropdownSelect,
  GridFocusGroup,
  VerticalFocusGroup,
} from "../../components";
import { SettingsSection } from "./settings-section";

export const CONTROLLER_SETTINGS_REGION_ID = "settings-controllers-content";

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
      type="button"
      variant="secondary"
      size="small"
      focusId={id}
      disabled={disabled}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
    >
      {label && (
        <span className="controller-settings__accessible-label">{label}</span>
      )}
      {label ? <span aria-hidden="true">{children}</span> : children}
    </Button>
  ),
  Select: ({
    id,
    label,
    value,
    options,
    disabled,
    onChange,
  }: Readonly<ControllerSelectProps>) => (
    <DropdownSelect
      focusId={id}
      label={label}
      value={value}
      options={options}
      disabled={disabled}
      onValueChange={onChange}
    />
  ),
  Checkbox: ({
    id,
    label,
    checked,
    disabled,
    onChange,
  }: Readonly<ControllerCheckboxProps>) => (
    <Checkbox
      focusId={id}
      label={label}
      checked={checked}
      disabled={disabled}
      onChange={onChange}
    />
  ),
  Grid: GridFocusGroup,
};

export function ControllerSettingsSection({
  className,
}: Readonly<{ className?: string }>) {
  const { t } = useTranslation("settings");
  return (
    <SettingsSection
      className={className}
      title={t("controller_configuration.title")}
      description={null}
    >
      <VerticalFocusGroup regionId={CONTROLLER_SETTINGS_REGION_ID}>
        <ControllerSettingsPanel controls={controls} />
      </VerticalFocusGroup>
    </SettingsSection>
  );
}
