import "./styles.scss";
import cn from "classnames";
import { useGamepadStore } from "../../../stores/gamepad.store";
import xboxButtonX from "../../../assets/xbox-button-x.svg?url";

const GLYPHS = {
  A: ["A", "×"], B: ["B", "○"], X: ["X", "□"], Y: ["Y", "△"],
  LB: ["LB", "L1"], RB: ["RB", "R1"], LT: ["LT", "L2"], RT: ["RT", "R2"],
  L3: ["LS", "L3"], R3: ["RS", "R3"], BACK: ["View", "Create"],
  START: ["Menu", "Options"], HOME: ["Xbox", "PS"],
  UP: ["↑", "↑"], DOWN: ["↓", "↓"], LEFT: ["←", "←"], RIGHT: ["→", "→"],
} as const;

interface ControllerButtonGlyphProps {
  button: keyof typeof GLYPHS;
  className?: string;
}

export function ControllerButtonGlyph({ button, className }: Readonly<ControllerButtonGlyphProps>) {
  const playStation = useGamepadStore((state) => {
    const pad = state.connectedGamepads.find((item) => item.index === state.activeGamepadIndex) ?? state.connectedGamepads[0];
    return /playstation|dualsense|dualshock/i.test(pad?.layout ?? "");
  });
  const glyph = GLYPHS[button][playStation ? 1 : 0];
  return (
    <span className={cn("controller-button-glyph", className)} aria-label={glyph} role="img">
      <span className="controller-button-glyph__group">
        {!playStation && button === "X" ? (
          <img className="controller-button-glyph__image" src={xboxButtonX} alt="" draggable={false} />
        ) : (
          <span className="controller-button-glyph__label">{glyph}</span>
        )}
      </span>
    </span>
  );
}
