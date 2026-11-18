import { test } from "node:test";
import assert from "node:assert/strict";
import {
  googleOAuthTokenError,
  googleOAuthCallbackError,
  validateGoogleDesktopClient,
} from "./krysta-google-oauth.js";
test("Desktop OAuth configuration rejects invalid ID and malformed secret", () => {
  assert.deepEqual(
    validateGoogleDesktopClient(" 123-ab.apps.googleusercontent.com ", "abc"),
    { client_id: "123-ab.apps.googleusercontent.com", client_secret: "abc" }
  );
  assert.throws(() =>
    validateGoogleDesktopClient("https://untrusted.example", "abc")
  );
  assert.throws(() =>
    validateGoogleDesktopClient("valid.apps.googleusercontent.com", "")
  );
  assert.throws(() =>
    validateGoogleDesktopClient("valid.apps.googleusercontent.com", "a b")
  );
});
test("OAuth failure messages never echo secret endpoint descriptions", () => {
  for (const code of [
    "invalid_client",
    "invalid_grant",
    "unauthorized_client",
    "access_denied",
    "other",
  ]) {
    const message = googleOAuthTokenError(code, 401);
    assert.equal(message.includes("secret_access_token"), false);
    assert.match(message, /Google OAuth/);
  }
  assert.match(googleOAuthTokenError("invalid_client", 401), /Desktop/);
  assert.match(googleOAuthTokenError("invalid_grant", 400), /ponownie/);
});
test("OAuth callback handles declined access immediately instead of timing out", () => {
  assert.match(googleOAuthCallbackError("access_denied"), /anulowane/);
  assert.match(googleOAuthCallbackError("org_internal"), /organizacji/);
});
