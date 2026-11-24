import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";

let capture:
  | {
      owner: WebContents;
      token: string;
      timeout: ReturnType<typeof setTimeout>;
    }
  | undefined;

export function beginControllerShortcutCapture(owner: WebContents) {
  if (capture || owner.isDestroyed() || !owner.isFocused()) return null;

  const token = randomUUID();
  const timeout = setTimeout(
    () => endControllerShortcutCapture(owner, token),
    12000
  );
  timeout.unref();
  capture = { owner, token, timeout };
  return token;
}

export function endControllerShortcutCapture(
  owner: WebContents,
  token: unknown
) {
  if (!capture || capture.owner !== owner || capture.token !== token) return;
  clearTimeout(capture.timeout);
  capture = undefined;
}

export function isControllerShortcutCaptureActive() {
  if (!capture) return false;
  if (capture.owner.isDestroyed()) {
    endControllerShortcutCapture(capture.owner, capture.token);
    return false;
  }
  return true;
}
