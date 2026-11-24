import { app, dialog, ipcMain, safeStorage, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import {
  googleOAuthCallbackError,
  googleOAuthTokenError,
  validateGoogleDesktopClient,
} from "@main/services/krysta-google-oauth";
type Credentials = {
  google?: { clientId: string; clientSecret: string; refreshToken: string };
  googleClient?: { clientId: string; clientSecret: string };
  synology?: { url: string; username: string; password: string };
};
const file = () =>
  path.join(app.getPath("userData"), "krysta-cloud-accounts.bin");
async function read(): Promise<Credentials> {
  try {
    return JSON.parse(safeStorage.decryptString(await fs.readFile(file())));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw Error("Cannot decrypt cloud credentials");
  }
}
async function write(c: Credentials) {
  if (
    !safeStorage.isEncryptionAvailable() ||
    safeStorage.getSelectedStorageBackend?.() === "basic_text"
  )
    throw Error("Secure storage unavailable");
  await fs.writeFile(
    file() + ".tmp",
    safeStorage.encryptString(JSON.stringify(c)),
    { mode: 0o600 }
  );
  await fs.rename(file() + ".tmp", file());
}
let busy = false;
async function exclusive<T>(fn: () => Promise<T>) {
  if (busy) throw Error("Account operation already running");
  busy = true;
  try {
    return await fn();
  } finally {
    busy = false;
  }
}
type DesktopClient = { client_id: string; client_secret: string };
const desktopClient = validateGoogleDesktopClient;
function builtInClient() {
  return desktopClient(
    import.meta.env.MAIN_VITE_KRYSTA_GOOGLE_CLIENT_ID,
    import.meta.env.MAIN_VITE_KRYSTA_GOOGLE_CLIENT_SECRET
  );
}
function getSavedClient(c: Credentials): DesktopClient | null {
  const client = c.googleClient ?? c.google; // Accounts connected before this update already contain the working Desktop client.
  if (!client) return null;
  try {
    return desktopClient(client.clientId, client.clientSecret);
  } catch {
    return null;
  }
}
async function preferredClient(): Promise<DesktopClient | null> {
  const stored = getSavedClient(await read());
  if (stored) return stored; // Prefer a Desktop configuration that previously authenticated successfully.
  try {
    return builtInClient();
  } catch {
    return null;
  }
}
async function selectDesktopClient(): Promise<DesktopClient | null> {
  const result = await dialog.showOpenDialog({
    title: "Google OAuth Desktop JSON",
    properties: ["openFile"],
    filters: [{ name: "OAuth client JSON", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const selected = result.filePaths[0],
    st = await fs.lstat(selected);
  if (!st.isFile() || st.isSymbolicLink() || st.size > 128 * 1024)
    throw Error("Invalid OAuth JSON file");
  let data;
  try {
    data = JSON.parse(await fs.readFile(selected, "utf8"));
  } catch {
    throw Error("Invalid OAuth JSON file");
  }
  if (
    !data?.installed ||
    data.web ||
    data.installed.token_uri !== "https://oauth2.googleapis.com/token"
  )
    throw Error(
      "Wybierz plik JSON klienta Desktop, nie Web / Select a Desktop OAuth client JSON"
    );
  return desktopClient(data.installed.client_id, data.installed.client_secret);
}
async function googleRetryFetch(url: string, init: RequestInit, timeout = 30000, refresh?: () => Promise<string>): Promise<Response> {
  let refreshed = false;
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
    } catch (error) {
      if (attempt >= 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
      continue;
    }
    if (response.status === 401 && refresh && !refreshed) {
      refreshed = true;
      await response.body?.cancel();
      const headers = new Headers(init.headers);
      headers.set("Authorization", "Bearer " + await refresh());
      init = { ...init, headers };
      continue;
    }
    if (attempt >= 2 || ![408, 429, 500, 502, 503, 504].includes(response.status)) return response;
    const retryAfter = response.headers.get("Retry-After");
    const seconds = retryAfter === null ? 0 : Number(retryAfter);
    const delay = Number.isFinite(seconds) ? Math.max(1000 * 2 ** attempt, seconds * 1000) : 1000 * 2 ** attempt;
    if (delay > 30000) return response;
    await response.body?.cancel();
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}
async function tokenRequest(params: Record<string, string>) {
  const request = params.grant_type === "refresh_token" ? googleRetryFetch : fetch;
  const r = await request("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(30000),
    redirect: "error",
  }).catch((error: unknown) => {
    const name = error instanceof Error ? error.name : "";
    throw Error(name === "TimeoutError" || name === "AbortError"
      ? "Google OAuth: przekroczono czas połączenia. Spróbuj ponownie."
      : "Google OAuth: nie można połączyć się z serwerem Google. Sprawdź internet, DNS i zaporę.");
  });
  if (!r.ok) {
    // Only show recognized error codes, never Google response text, authorization codes or secrets.
    const value = await r.json().catch(() => null);
    const code = typeof value?.error === "string" ? value.error : "";
    throw Error(googleOAuthTokenError(code, r.status));
  }
  return (await r.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
}
type GoogleCredentials = NonNullable<Credentials["google"]>;
type CachedGoogleToken = { access_token: string; expiresAt: number };
const googleTokens = new Map<string, CachedGoogleToken>();
const googleRefreshes = new Map<string, Promise<CachedGoogleToken>>();
let googleTokenGeneration = 0;
function clearGoogleTokens() {
  googleTokenGeneration++;
  googleTokens.clear();
  googleRefreshes.clear();
}
async function getGoogleAccessToken(g: GoogleCredentials, force = false): Promise<CachedGoogleToken> {
  const key = createHash("sha256").update(JSON.stringify(g)).digest("hex");
  const cached = googleTokens.get(key);
  if (!force && cached && cached.expiresAt > Date.now() + 60_000) return cached;
  const pending = googleRefreshes.get(key);
  if (pending) return pending;
  const generation = googleTokenGeneration;
  const request = (async () => {
    const t = await tokenRequest({ client_id: g.clientId, client_secret: g.clientSecret, refresh_token: g.refreshToken, grant_type: "refresh_token" });
    if (!t.access_token) throw Error("Google nie zwrócił tokenu dostępu.");
    if (generation !== googleTokenGeneration) throw Error("Konto Google zostało zmienione.");
    const seconds = typeof t.expires_in === "number" && Number.isFinite(t.expires_in) ? Math.max(0, Math.min(t.expires_in, 3600)) : 0;
    const result = { access_token: t.access_token, expiresAt: Date.now() + seconds * 1000 };
    googleTokens.set(key, result);
    return result;
  })();
  googleRefreshes.set(key, request);
  try { return await request; } finally { if (googleRefreshes.get(key) === request) googleRefreshes.delete(key); }
}
ipcMain.handle("krysta:cloud-account-status", async () => {
  const c = await read().catch(() => null);
  if (!c) return { google: false, synology: false, googleConfigured: false, credentialError: "Nie można odczytać zaszyfrowanych danych konta. Sprawdź profil Windows i zabezpieczenia systemu." };
  let configured = !!getSavedClient(c);
  if (!configured) {
    try {
      builtInClient();
      configured = true;
    } catch {
      // No OAuth client is configured for this installation.
    }
  }
  return {
    google: !!c.google,
    synology: !!c.synology,
    googleConfigured: configured,
  };
});
async function probeGoogleDrive(accessToken: string) {
  const probe = await fetch(
    "https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id)",
    {
      headers: { Authorization: "Bearer " + accessToken },
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    }
  );
  await probe.body?.cancel();
  if (!probe.ok)
    throw Error(
      (probe.status === 401 ? "Google Drive: sesja wygasła. Połącz konto ponownie. " : probe.status === 429 ? "Google Drive: limit zapytań. Spróbuj później. " : probe.status >= 500 ? "Google Drive: chwilowa awaria serwera. " : "") +
      "Google Drive: dostęp do plików niedostępny (HTTP " +
        probe.status +
        "). Sprawdź Drive API i uprawnienia aplikacji. / Drive access unavailable."
    );
}
async function verifyGoogleWriteAccess(accessToken: string) {
  const auth = { Authorization: "Bearer " + accessToken };
  const name = ".krysta-connection-test-" + randomBytes(12).toString("hex");
  const response = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST", headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/octet-stream" }),
    redirect: "error", signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw Error("Google Drive: brak możliwości utworzenia pliku testowego (HTTP " + response.status + "). Sprawdź uprawnienia i wolne miejsce.");
  }
  const data = await response.json() as { id?: string };
  if (!data.id || !/^[\w-]+$/.test(data.id)) throw Error("Google Drive: nieprawidłowy identyfikator pliku testowego.");
  const url = "https://www.googleapis.com/drive/v3/files/" + data.id;
  try {
    const check = await googleRetryFetch(url + "?fields=id,name,capabilities(canEdit)", { headers: auth, redirect: "error" }, 15000);
    if (!check.ok) { await check.body?.cancel(); throw Error("Google Drive: nie można odczytać pliku testowego (HTTP " + check.status + ")."); }
    const info = await check.json() as { id?: string; name?: string; capabilities?: { canEdit?: boolean } };
    if (info.id !== data.id || info.name !== name || info.capabilities?.canEdit !== true)
      throw Error("Google Drive: nie potwierdzono uprawnień do edycji pliku testowego.");
  } finally {
    const cleanup = await fetch(url, { method: "DELETE", headers: auth, redirect: "error", signal: AbortSignal.timeout(15000) });
    await cleanup.body?.cancel();
    if (!cleanup.ok && cleanup.status !== 404) throw Error("Google Drive: nie udało się usunąć pliku testowego " + name + ".");
  }
}
async function connectGoogle(installed: DesktopClient) {
  if (
    !safeStorage.isEncryptionAvailable() ||
    safeStorage.getSelectedStorageBackend?.() === "basic_text"
  )
    throw Error("Secure storage unavailable");
  const verifier = randomBytes(48).toString("base64url"),
    state = randomBytes(32).toString("base64url");
  let callback: (code: string) => void = () => {},
    rejectCallback: (e: Error) => void = () => {};
  const codePromise = new Promise<string>((resolve, reject) => {
    callback = resolve;
    rejectCallback = reject;
  });
  void codePromise.catch(() => {});
  let callbackAccepted = false;
  const server = createServer((req, res) => {
    let u: URL;
    try { u = new URL(req.url ?? "/", "http://127.0.0.1"); }
    catch { res.writeHead(400); res.end("Invalid request"); return; }
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    if (
      callbackAccepted ||
      req.method !== "GET" ||
      u.pathname !== "/callback" ||
      u.searchParams.get("state") !== state
    ) {
      res.writeHead(400);
      res.end("Invalid request");
      return;
    }
    callbackAccepted = true;
    const error = u.searchParams.get("error");
    if (error) {
      res.end("Google sign-in was not completed. Return to Krysta Launcher.");
      rejectCallback(Error(googleOAuthCallbackError(error)));
      return;
    }
    const code = u.searchParams.get("code");
    if (!code) {
      res.writeHead(400);
      res.end("Authorization code missing.");
      rejectCallback(Error("Google authorization code missing"));
      return;
    }
    res.end("Authorization received. Return to Krysta Launcher.");
    callback(code);
  });
  const timer = setTimeout(
    () => rejectCallback(Error("Logowanie Google: upłynął czas oczekiwania. Zamknij kartę logowania i spróbuj ponownie.")),
    180000
  );
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", () => reject(Error("Nie można uruchomić lokalnego połączenia OAuth. Sprawdź zaporę systemową.")));
      server.listen(0, "127.0.0.1", resolve);
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") throw Error("Callback unavailable");
    const redirect = "http://127.0.0.1:" + addr.port + "/callback";
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.search = new URLSearchParams({
      client_id: installed.client_id,
      redirect_uri: redirect,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/drive.file",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      state,
      access_type: "offline",
      prompt: "consent",
    }).toString();
    await shell.openExternal(u.toString()).catch(() => {
      throw Error("Nie można otworzyć przeglądarki. Sprawdź domyślną przeglądarkę systemową.");
    });
    const code = await codePromise;
    const t = await tokenRequest({
      client_id: installed.client_id,
      client_secret: installed.client_secret,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirect,
    });
    if (!t.refresh_token || !t.access_token)
      throw Error("Google nie udzielił dostępu offline. Ponownie połącz konto i zaakceptuj wymagane uprawnienia.");
    await probeGoogleDrive(t.access_token);
    clearGoogleTokens();
    await write({
      ...(await read()),
      googleClient: {
        clientId: installed.client_id,
        clientSecret: installed.client_secret,
      },
      google: {
        clientId: installed.client_id,
        clientSecret: installed.client_secret,
        refreshToken: t.refresh_token,
      },
    });
    return true;
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    server.close();
  }
}
// One entry point: use a previously working client, built-in credentials, or
// ask for Desktop JSON only when no configured client is available.
ipcMain.handle("krysta:cloud-google-connect", () =>
  exclusive(async () => {
    const client = (await preferredClient()) ?? (await selectDesktopClient());
    return client ? connectGoogle(client) : false;
  })
);
ipcMain.handle("krysta:cloud-google-connect-json", () =>
  exclusive(async () => {
    const client = await selectDesktopClient();
    return client ? connectGoogle(client) : false;
  })
);
ipcMain.handle("krysta:cloud-google-test", () =>
  exclusive(async () => {
    const c = await read(),
      g = c.google;
    if (!g)
      throw Error(
        "Google Drive nie jest połączony / Google Drive is not connected"
      );
    const t = await getGoogleAccessToken(g, true);
    if (!t.access_token)
      throw Error(
        "Google nie zwrócił tokenu dostępu. Połącz konto ponownie. / Google access token missing"
      );
    await probeGoogleDrive(t.access_token);
    await verifyGoogleWriteAccess(t.access_token);
    return true;
  })
);
ipcMain.handle(
  "krysta:cloud-synology-connect",
  (_e, url: unknown, username: unknown, password: unknown) =>
    exclusive(async () => {
      if (
        typeof url !== "string" ||
        typeof username !== "string" ||
        typeof password !== "string" ||
        !username ||
        !password ||
        url.length > 2048
      )
        throw Error("Invalid NAS credentials");
      const u = new URL(url);
      if (
        u.protocol !== "https:" ||
        u.username ||
        u.password ||
        u.search ||
        u.hash
      )
        throw Error("Use HTTPS WebDAV folder URL");
      const authorization =
        "Basic " + Buffer.from(username + ":" + password).toString("base64");
      const r = await fetch(u, {
        method: "PROPFIND",
        headers: { Authorization: authorization, Depth: "0" },
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      await r.body?.cancel();
      if (r.status !== 207)
        throw Error("WebDAV connection failed (" + r.status + ")");
      await write({
        ...(await read()),
        synology: { url: u.toString(), username, password },
      });
      return true;
    })
);
ipcMain.handle("krysta:cloud-account-disconnect", (_e, provider: unknown) =>
  exclusive(async () => {
    const c = await read();
    if (provider === "google") {
      clearGoogleTokens();
      if (c.google && !c.googleClient)
        c.googleClient = {
          clientId: c.google.clientId,
          clientSecret: c.google.clientSecret,
        };
      delete c.google;
    } else if (provider === "synology") delete c.synology;
    else throw Error("Invalid provider");
    await write(c);
    return true;
  })
);

type DirectProvider = "google" | "synology";
export async function directCloudIdentity(provider: DirectProvider) {
  const c = await read();
  const account = c[provider];
  if (!account) throw Error("Connect the selected cloud account first");
  return createHash("sha256").update(JSON.stringify(account)).digest("hex");
}
export async function uploadCloudSnapshot(
  provider: DirectProvider,
  identity: string,
  gameKey: string,
  snapshotId: string,
  dir: string,
  names: string[]
) {
  const c = await read(),
    account = c[provider];
  if (
    !account ||
    createHash("sha256").update(JSON.stringify(account)).digest("hex") !==
      identity
  )
    throw Error("Cloud account changed");
  if (
    !/^[a-f0-9]{64}$/.test(gameKey) ||
    !/^[a-f0-9-]{36}$/.test(snapshotId) ||
    names.some((n) => !/^\d+$/.test(n))
  )
    throw Error("Invalid snapshot identity");
  const files = [...names, "manifest.json"];
  // Bound memory per upload; the manifest is committed last, never overwriting an older snapshot.
  async function payload(name: string) {
    const p = path.join(dir, name),
      st = await fs.lstat(p);
    if (!st.isFile() || st.isSymbolicLink() || st.size > 64 * 1024 ** 2)
      throw Error("Individual cloud save file exceeds 64 MB or is unsafe");
    return fs.readFile(p);
  }
  if (provider === "google" && c.google) {
    const g = c.google,
      t = await getGoogleAccessToken(g);
    if (!t.access_token) throw Error("Google access token unavailable");
    const auth = { Authorization: "Bearer " + t.access_token };
    const createFolder = async (name: string, parent?: string) => {
      const response = await fetch(
        "https://www.googleapis.com/drive/v3/files?fields=id",
        {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            mimeType: "application/vnd.google-apps.folder",
            ...(parent ? { parents: [parent] } : {}),
          }),
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        }
      );
      if (!response.ok)
        throw Error(
          "Google Drive folder creation failed (" + response.status + ")"
        );
      const data = (await response.json()) as { id?: string };
      if (!data.id) throw Error("Missing Google folder ID");
      return data.id;
    };
    const q =
      "trashed = false and mimeType = 'application/vnd.google-apps.folder' and name = 'Krysta Cloud'";
    const list = await fetch(
      "https://www.googleapis.com/drive/v3/files?" +
        new URLSearchParams({
          q,
          fields: "files(id),nextPageToken",
          pageSize: "100",
        }),
      { headers: auth, redirect: "error", signal: AbortSignal.timeout(30000) }
    );
    if (!list.ok)
      throw Error("Google Drive folder lookup failed (" + list.status + ")");
    const data = (await list.json()) as {
      files?: { id: string }[];
      nextPageToken?: string;
    };
    if (data.nextPageToken || (data.files?.length ?? 0) > 1)
      throw Error("Multiple Krysta Cloud folders; resolve ambiguity in Drive");
    const root = data.files?.[0]?.id ?? (await createFolder("Krysta Cloud"));
    const folder = await createFolder(gameKey + "-" + snapshotId, root);
    for (const name of files) {
      const bytes = await payload(name),
        boundary = "krysta_" + randomBytes(18).toString("hex");
      const body = Buffer.concat([
        Buffer.from(
          "--" +
            boundary +
            "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" +
            JSON.stringify({ name, parents: [folder] }) +
            "\r\n--" +
            boundary +
            "\r\nContent-Type: application/octet-stream\r\n\r\n"
        ),
        bytes,
        Buffer.from("\r\n--" + boundary + "--\r\n"),
      ]);
      const response = await fetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
        {
          method: "POST",
          headers: {
            ...auth,
            "Content-Type": "multipart/related; boundary=" + boundary,
          },
          body: new Uint8Array(body),
          redirect: "error",
          signal: AbortSignal.timeout(120000),
        }
      );
      await response.body?.cancel();
      if (!response.ok)
        throw Error("Google Drive upload failed (" + response.status + ")");
    }
  } else if (provider === "synology" && c.synology) {
    const nas = c.synology,
      root = new URL(nas.url);
    if (
      root.protocol !== "https:" ||
      root.username ||
      root.password ||
      root.search ||
      root.hash
    )
      throw Error("Unsafe NAS URL");
    if (!root.pathname.endsWith("/")) root.pathname += "/";
    const auth = {
      Authorization:
        "Basic " +
        Buffer.from(nas.username + ":" + nas.password).toString("base64"),
    };
    const cloud = new URL("Krysta%20Cloud/", root),
      snapshot = new URL(gameKey + "-" + snapshotId + "/", cloud);
    for (const u of [cloud, snapshot]) {
      const response = await fetch(u, {
        method: "MKCOL",
        headers: auth,
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      await response.body?.cancel();
      if (response.status !== 201 && response.status !== 405)
        throw Error("WebDAV folder creation failed (" + response.status + ")");
    }
    for (const name of files) {
      const response = await fetch(new URL(name, snapshot), {
        method: "PUT",
        headers: {
          ...auth,
          "Content-Type": "application/octet-stream",
          "If-None-Match": "*",
        },
        body: new Uint8Array(await payload(name)),
        redirect: "error",
        signal: AbortSignal.timeout(120000),
      });
      await response.body?.cancel();
      if (!response.ok)
        throw Error("WebDAV upload failed (" + response.status + ")");
    }
  } else throw Error("Cloud account unavailable");
}

type RemoteManifest = {
  id: string;
  createdAt: string;
  files: { name: string; original: string; size: number }[];
};
const uuidPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
async function boundedBody(response: Response, limit: number) {
  if (!response.ok)
    throw Error("Cloud download failed (" + response.status + ")");
  const reader = response.body?.getReader();
  if (!reader) throw Error("Missing cloud response");
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (
      let chunk = await reader.read();
      !chunk.done;
      chunk = await reader.read()
    ) {
      const { value } = chunk;
      total += value.byteLength;
      if (total > limit) throw Error("Cloud response exceeds size limit");
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
function validateRemoteManifest(value: unknown, id: string): RemoteManifest {
  const m = value as RemoteManifest;
  if (
    !m ||
    m.id !== id ||
    typeof m.createdAt !== "string" ||
    !Number.isFinite(Date.parse(m.createdAt)) ||
    !Array.isArray(m.files) ||
    !m.files.length ||
    m.files.length > 5000
  )
    throw Error("Invalid cloud manifest");
  const names = new Set<string>();
  let total = 0;
  for (const f of m.files) {
    if (
      !f ||
      typeof f.name !== "string" ||
      !/^\d+$/.test(f.name) ||
      names.has(f.name) ||
      typeof f.original !== "string" ||
      !Number.isSafeInteger(f.size) ||
      f.size < 0 ||
      f.size > 64 * 1024 ** 2
    )
      throw Error("Invalid cloud save entry");
    names.add(f.name);
    total += f.size;
    if (total > 5 * 1024 ** 3) throw Error("Cloud snapshot too large");
  }
  return m;
}
async function remoteCloud(
  provider: DirectProvider,
  identity: string,
  gameKey: string
) {
  if (
    !/^[a-f0-9]{64}$/.test(gameKey) ||
    (await directCloudIdentity(provider)) !== identity
  )
    throw Error("Cloud account changed");
  const c = await read(),
    account = c[provider];
  if (
    !account ||
    createHash("sha256").update(JSON.stringify(account)).digest("hex") !==
      identity
  )
    throw Error("Cloud account changed");
  if (provider === "google" && c.google) {
    const g = c.google,
      t = await getGoogleAccessToken(g);
    if (!t.access_token) throw Error("Google access token unavailable");
    const auth = { Authorization: "Bearer " + t.access_token };
    const list = async (q: string) => {
      const result: { id: string; name: string }[] = [];
      let page = "";
      do {
        const params = new URLSearchParams({
          q,
          fields: "nextPageToken,files(id,name)",
          pageSize: "100",
        });
        if (page) params.set("pageToken", page);
        const res = await googleRetryFetch(
          "https://www.googleapis.com/drive/v3/files?" + params,
          {
            headers: auth,
            redirect: "error",
            signal: AbortSignal.timeout(30000),
          }, 30000, async () => (await getGoogleAccessToken(g, true)).access_token
        );
        const data = JSON.parse(
          (await boundedBody(res, 2 * 1024 ** 2)).toString("utf8")
        );
        if (!Array.isArray(data.files)) throw Error("Invalid Drive list");
        for (const f of data.files)
          if (
            typeof f.id === "string" &&
            /^[\w-]+$/.test(f.id) &&
            typeof f.name === "string"
          )
            result.push(f);
        page = data.nextPageToken ?? "";
        if (result.length > 10000) throw Error("Cloud history too large");
      } while (page);
      return result;
    };
    const roots = await list(
      "trashed = false and mimeType = 'application/vnd.google-apps.folder' and name = 'Krysta Cloud'"
    );
    if (roots.length > 1) throw Error("Multiple Krysta Cloud folders");
    const folders = roots.length
      ? await list(
          "trashed = false and '" +
            roots[0].id +
            "' in parents and mimeType = 'application/vnd.google-apps.folder' and name contains '" +
            gameKey +
            "-'"
        )
      : [];
    const snapshots = folders.filter(
      (f) =>
        f.name.startsWith(gameKey + "-") && uuidPattern.test(f.name.slice(65))
    );
    return {
      ids: snapshots.map((f) => f.name.slice(65)),
      get: async (id: string, name: string, limit: number) => {
        const matches = snapshots.filter((f) => f.name === gameKey + "-" + id);
        if (matches.length !== 1)
          throw Error("Cloud snapshot missing or ambiguous");
        const children = await list(
          "trashed = false and '" +
            matches[0].id +
            "' in parents and name = '" +
            name +
            "'"
        );
        if (!children.length) return null;
        if (children.length !== 1) throw Error("Duplicate cloud file");
        return boundedBody(
          await googleRetryFetch(
            "https://www.googleapis.com/drive/v3/files/" +
              children[0].id +
              "?alt=media",
            {
              headers: auth,
              redirect: "error",
              signal: AbortSignal.timeout(120000),
            }, 120000, async () => (await getGoogleAccessToken(g, true)).access_token
          ),
          limit
        );
      },
    };
  }
  if (provider === "synology" && c.synology) {
    const nas = c.synology,
      root = new URL(nas.url);
    if (
      root.protocol !== "https:" ||
      root.username ||
      root.password ||
      root.search ||
      root.hash
    )
      throw Error("Unsafe NAS URL");
    if (!root.pathname.endsWith("/")) root.pathname += "/";
    const cloud = new URL("Krysta%20Cloud/", root),
      auth = {
        Authorization:
          "Basic " +
          Buffer.from(nas.username + ":" + nas.password).toString("base64"),
      };
    const res = await fetch(cloud, {
      method: "PROPFIND",
      headers: { ...auth, Depth: "1" },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    const xml =
      res.status === 404
        ? ""
        : (await boundedBody(res, 8 * 1024 ** 2)).toString("utf8");
    if (res.status === 404) await res.body?.cancel();
    const ids = new Set<string>();
    for (const match of xml.matchAll(
      /<(?:[\w.-]+:)?href\b[^>]*>([^<]+)<\/(?:[\w.-]+:)?href>/gi
    )) {
      try {
        const u = new URL(match[1].replace(/&amp;/g, "&"), cloud),
          name = decodeURIComponent(
            u.pathname.replace(/\/$/, "").split("/").pop() ?? ""
          );
        if (
          u.origin === cloud.origin &&
          u.pathname.startsWith(cloud.pathname) &&
          name.startsWith(gameKey + "-") &&
          uuidPattern.test(name.slice(65))
        )
          ids.add(name.slice(65));
      } catch {
        /* invalid href */
      }
    }
    return {
      ids: [...ids],
      get: async (id: string, name: string, limit: number) => {
        const response = await fetch(
          new URL(gameKey + "-" + id + "/" + name, cloud),
          {
            headers: auth,
            redirect: "error",
            signal: AbortSignal.timeout(120000),
          }
        );
        if (response.status === 404) {
          await response.body?.cancel();
          return null;
        }
        return boundedBody(response, limit);
      },
    };
  }
  throw Error("Cloud account unavailable");
}
export async function listRemoteCloudSnapshots(
  provider: DirectProvider,
  identity: string,
  gameKey: string
) {
  const remote = await remoteCloud(provider, identity, gameKey),
    results: RemoteManifest[] = [];
  for (const id of [...new Set(remote.ids)]) {
    const bytes = await remote.get(id, "manifest.json", 8 * 1024 ** 2);
    if (!bytes) continue;
    results.push(
      validateRemoteManifest(JSON.parse(bytes.toString("utf8")), id)
    );
  }
  return results.sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
  );
}
export async function downloadCloudSnapshot(
  provider: DirectProvider,
  identity: string,
  gameKey: string,
  id: string,
  dir: string
) {
  if (!uuidPattern.test(id)) throw Error("Invalid snapshot ID");
  const remote = await remoteCloud(provider, identity, gameKey);
  if (!remote.ids.includes(id)) throw Error("Cloud snapshot not found");
  const bytes = await remote.get(id, "manifest.json", 8 * 1024 ** 2);
  if (!bytes) throw Error("Incomplete cloud snapshot");
  const m = validateRemoteManifest(JSON.parse(bytes.toString("utf8")), id);
  for (const f of m.files) {
    const content = await remote.get(id, f.name, f.size);
    if (!content || content.length !== f.size)
      throw Error("Incomplete cloud save");
    await fs.writeFile(path.join(dir, f.name), content, {
      flag: "wx",
      mode: 0o600,
    });
  }
  await fs.writeFile(path.join(dir, "manifest.json"), bytes, {
    flag: "wx",
    mode: 0o600,
  });
}

// Dedicated metadata snapshot; never includes credentials or raw save paths.
export async function uploadAchievementBackup(identity: string, payload: string, kind: "achievement" | "story" | "library" | "settings" = "achievement") {
  const c = await read();
  const g = c.google;
  if (!g || await directCloudIdentity("google") !== identity) throw Error("Cloud account changed");
  if (Buffer.byteLength(payload) > 16 * 1024 ** 2) throw Error("Achievement backup exceeds 16 MB");
  const token = await getGoogleAccessToken(g);
  const boundary = "krysta_" + randomBytes(18).toString("hex");
  const metadata = { name: "Krysta-" + (kind === "achievement" ? "achievements" : kind) + "-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json", mimeType: "application/json", appProperties: { krystaKind: kind + "-backup-v1" } };
  const body = "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(metadata) + "\r\n--" + boundary + "\r\nContent-Type: application/json\r\n\r\n" + payload + "\r\n--" + boundary + "--\r\n";
  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", { method: "POST", headers: { Authorization: "Bearer " + token.access_token, "Content-Type": "multipart/related; boundary=" + boundary }, body, redirect: "error", signal: AbortSignal.timeout(120000) });
  if (!response.ok) { await response.body?.cancel(); throw Error("Google Drive achievement backup failed (" + response.status + ")"); }
  const result = await response.json() as { id?: string };
  if (!result.id) throw Error("Google Drive backup ID missing");
}

export async function uploadGoogleMedia(identity: string, name: string, bytes: Uint8Array, hash: string, signal: AbortSignal) {
  const g = (await read()).google;
  if (!g || await directCloudIdentity("google") !== identity || signal.aborted) throw Error("Cloud account changed or cancelled");
  if (bytes.byteLength > 96 * 1024 ** 2 || !/^[a-f0-9]{64}$/.test(hash)) throw Error("Invalid media");
  const token = await getGoogleAccessToken(g);
  const auth = { Authorization: "Bearer " + token.access_token };
  const q = "trashed = false and appProperties has { key='krystaMediaHash' and value='" + hash + "' }";
  const lookup = await fetch("https://www.googleapis.com/drive/v3/files?" + new URLSearchParams({q, fields:"files(id)",pageSize:"1"}), {headers:auth,signal,redirect:"error"});
  if (!lookup.ok) throw Error("Google media lookup failed");
  if (((await lookup.json()) as {files?: {id:string}[]}).files?.length) return;
  const boundary = "krysta_" + randomBytes(18).toString("hex");
  const body = Buffer.concat([Buffer.from("--"+boundary+"\r\nContent-Type: application/json\r\n\r\n"+JSON.stringify({name,appProperties:{krystaMediaHash:hash,krystaKind:"media-v1"}})+"\r\n--"+boundary+"\r\nContent-Type: application/octet-stream\r\n\r\n"),bytes,Buffer.from("\r\n--"+boundary+"--\r\n")]);
  if (signal.aborted || await directCloudIdentity("google") !== identity) throw Error("Cloud account changed or cancelled");
  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",{method:"POST",headers:{...auth,"Content-Type":"multipart/related; boundary="+boundary},body:new Uint8Array(body),signal,redirect:"error"});
  if (!response.ok) throw Error("Google media upload failed ("+response.status+")");
  if (!((await response.json()) as {id?:string}).id) throw Error("Missing media ID");
}
