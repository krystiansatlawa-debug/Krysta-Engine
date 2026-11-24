import "./styles.scss";

import cn from "classnames";
import { useGamepadStore } from "../../../stores/gamepad.store";
import xboxButtonX from "../../../assets/xbox-button-x.svg?url";

const GLYPHS = {
  X: xboxButtonX,
};

interface ControllerButtonGlyphProps {
  button: keyof typeof GLYPHS;
  className?: string;
}

export function ControllerButtonGlyph({
  button,
  className,
}: Readonly<ControllerButtonGlyphProps>) {
  const playStation = useGamepadStore((state) => {
    const pad = state.connectedGamepads.find((item) => item.index === state.activeGamepadIndex) ?? state.connectedGamepads[0];
    return /playstation|dualsense|dualshock/i.test(pad?.layout ?? "");
  });
  return (
    <span
      className={cn("controller-button-glyph", className)}
      aria-hidden="true"
    >
      <span className="controller-button-glyph__group">
        {playStation ? <span aria-hidden="true">□</span> : <img
          className="controller-button-glyph__image"
          src={GLYPHS[button]}
          alt=""
          draggable={false}
        />}
      </span>
    </span>
  );
}
