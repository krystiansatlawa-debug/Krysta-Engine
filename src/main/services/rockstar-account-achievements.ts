import { BrowserWindow, session } from "electron";
import {
  fetchRockstarAwardedAchievements,
  type RockstarAchievementTitle,
} from "./achievements/rockstar-achievement-client.js";

const rockstarPartition = "persist:krysta-rockstar-account";
const profileUrl = "https://scapi.rockstargames.com/profile/getbasicprofile";
let loginWindow: BrowserWindow | null = null;

function authSession() {
  return session.fromPartition(rockstarPartition);
}

function authorizedRockstarUrl(raw: string) {
  try {
    const u = new URL(raw);
    return (
      u.protocol === "https:" &&
      (u.hostname === "rockstargames.com" ||
        u.hostname.endsWith(".rockstargames.com"))
    );
  } catch {
    return false;
  }
}

/** User signs in only on Rockstar-owned sites in an isolated browser session. */
export async function connectRockstarAchievements() {
  if (process.platform !== "win32")
    throw Error("Rockstar account sign-in is currently Windows-only");
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 980,
    height: 760,
    title: "Rockstar Games — logowanie",
    autoHideMenuBar: true,
    webPreferences: {
      partition: rockstarPartition,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  loginWindow = win;
  win.on("closed", () => {
    if (loginWindow === win) loginWindow = null;
  });
  win.webContents.setWindowOpenHandler(({ url }) => ({
    action: authorizedRockstarUrl(url) ? "allow" : "deny",
    overrideBrowserWindowOptions: {
      webPreferences: {
        partition: rockstarPartition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    },
  }));
  win.webContents.on("will-navigate", (e, url) => {
    if (!authorizedRockstarUrl(url)) e.preventDefault();
  });
  await win.loadURL("https://www.rockstargames.com/");
}

async function bearerToken(): Promise<string | null> {
  const cookies = await authSession().cookies.get({ name: "BearerToken" });
  const valid = cookies.find(
    (cookie) =>
      ((cookie.domain ?? "") === "rockstargames.com" ||
        (cookie.domain ?? "").endsWith(".rockstargames.com")) &&
      cookie.value.length > 20 &&
      cookie.value.length < 8192
  );
  return valid?.value ?? null;
}

async function getRockstarProfile(token: string) {
  const response = await fetch(profileUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
    redirect: "error",
    credentials: "omit",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Error("Rockstar account session expired");
  const body = await response.text();
  if (body.length > 512 * 1024) throw Error("Invalid Rockstar profile response");
  const data: unknown = JSON.parse(body);
  if (!data || typeof data !== "object") throw Error("Invalid Rockstar profile");
  const accounts = (data as Record<string, unknown>).accounts;
  if (!Array.isArray(accounts) || !accounts.length) throw Error("Missing Rockstar account");
  const first: unknown = accounts[0];
  const account = first && typeof first === "object"
    ? (first as Record<string, unknown>).rockstarAccount
    : undefined;
  if (!account || typeof account !== "object") throw Error("Missing Rockstar identity");
  const profile = account as Record<string, unknown>;
  const rockstarId = String(profile.rockstarId ?? "");
  if (!/^[0-9]{1,20}$/.test(rockstarId))
    throw Error("Invalid Rockstar ID returned by the server");
  const username = typeof profile.displayName === "string"
    ? profile.displayName.slice(0, 128)
    : "";
  return { rockstarId, username };
}

export async function rockstarAccountState() {
  if (process.platform !== "win32")
    return { connected: false, username: null as string | null };
  const token = await bearerToken();
  if (!token) return { connected: false, username: null as string | null };
  try {
    const profile = await getRockstarProfile(token);
    return { connected: true, username: profile.username };
  } catch {
    return { connected: false, username: null as string | null };
  }
}

export async function readRockstarAccountAwards(
  title: RockstarAchievementTitle
) {
  if (process.platform !== "win32") throw Error("Windows only");
  const token = await bearerToken();
  if (!token) throw Error("Connect your Rockstar Games account first");
  const profile = await getRockstarProfile(token);
  const awards = await fetchRockstarAwardedAchievements(
    title,
    profile.rockstarId,
    token
  );
  return { title, username: profile.username, awards, updatedAt: new Date().toISOString() };
}

export async function disconnectRockstarAchievements() {
  if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
  await authSession().clearStorageData();
}
