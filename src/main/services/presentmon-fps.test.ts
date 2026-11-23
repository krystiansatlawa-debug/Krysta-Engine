import assert from "node:assert/strict";
import test from "node:test";
import { PresentMonFps } from "./presentmon-fps.js";

test("counts the active game's presents from its busiest swap chain", () => {
  const frames = new PresentMonFps(123);
  frames.addLine(
    "\uFEFFApplication,ProcessID,SwapChainAddress,MsBetweenPresents"
  );
  frames.addLine("Game.exe,124,0x1,2");
  frames.addLine("Game.exe,124,0x1,2");
  frames.addLine("Game.exe,124,0x1,2");
  frames.addLine("Game, Deluxe.exe,123,0x2,8");
  frames.addLine("Game, Deluxe.exe,123,0x2,12");
  frames.addLine("Game, Deluxe.exe,123,0x3,2");
  frames.addLine("Game.exe,123,0x2,NA");
  frames.addLine("Game.exe,123,0x2,0");
  frames.addLine("Game.exe,123,0x2");
  assert.equal(frames.takeFps(), 100);
  assert.equal(frames.takeFps(), null);
});
