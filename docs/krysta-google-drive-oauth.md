# Krysta Cloud — Google Drive desktop OAuth

Google Drive login uses **Desktop app OAuth**, a localhost loopback callback (`127.0.0.1`) and PKCE. Never use the **Web application** OAuth client JSON. The user logs in through the system browser; Krysta never asks for the Google password.

## One-click login in released builds

To make **Connect Google account** open the browser without a JSON picker for new users, the Krysta release maintainer must:
1. Create a Google Cloud project, enable Google Drive API and configure the OAuth consent screen.
2. Create an **OAuth client ID → Desktop app**. Copy the Client ID and the matching Client Secret from the **same Desktop client**. Do not use credentials from separate clients.
3. In the GitHub repository, configure variable `KRYSTA_GOOGLE_CLIENT_ID` and Actions secret `KRYSTA_GOOGLE_CLIENT_SECRET`. The Windows release workflow passes these as `MAIN_VITE_KRYSTA_GOOGLE_CLIENT_ID` and `MAIN_VITE_KRYSTA_GOOGLE_CLIENT_SECRET` to the packaged app.
4. During testing, add intended Google accounts as OAuth test users. Google notes that External/Testing refresh tokens for Drive scopes generally expire after 7 days. Configure production publishing and required verification as appropriate.
5. Build and test the app on Windows with an account allowed by the consent screen. The **Test Google connection** action checks both token refresh and Drive API access.

OAuth clients for installed desktop apps are **public clients**. A desktop application's packaged client secret is not a true confidential secret: do not treat it as proof of the caller's identity. Do not commit any access tokens, refresh tokens or user JSON files.

## Fallback when OAuth isn't bundled

The same **Connect Google account** button opens the Desktop JSON picker only on first setup if no bundled or previously working client config exists. Select the JSON exported from Google Cloud for a **Desktop app**. After successful login, Krysta remembers the matching Desktop client information securely (Electron safeStorage) and will not ask for JSON again on reconnect.

The **Advanced Google OAuth options** expander lets the user choose a different Desktop JSON if built-in credentials are incorrect (for example, `401 invalid_client`). A valid Google Cloud OAuth registration is still required; Krysta cannot invent credentials or bypass Google's consent screen.

## Error guide

- `401 invalid_client` — mismatched/invalid Desktop Client ID and Secret, deleted/disabled client, or wrong OAuth project.
- `403 access_denied` — Google account declined consent, isn't on the list of test users, or the provider restricts it.
- `invalid_grant` — stored refresh token expired or was revoked; reconnect.
- `unauthorized_client` — verify this is a Desktop client, not a Web client.
- Drive API HTTP 403 — check the Drive API is enabled, permissions, and Google account policy.
- Browser doesn't return to Krysta — check local firewall and `127.0.0.1` loopback callback.

Reference: https://developers.google.com/identity/protocols/oauth2/native-app

## Release safety

Do not trigger a Windows build or publish a release while iterating on the feature branch. This document describes how the release maintainer configures a future release when authorized.
