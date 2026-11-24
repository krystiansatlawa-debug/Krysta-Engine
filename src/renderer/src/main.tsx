import React from "react";
import ReactDOM from "react-dom/client";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { Provider } from "react-redux";
import LanguageDetector from "i18next-browser-languagedetector";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";

import "@fontsource/noto-sans/400.css";
import "@fontsource/noto-sans/500.css";
import "@fontsource/noto-sans/700.css";

import "react-loading-skeleton/dist/skeleton.css";
import "react-tooltip/dist/react-tooltip.css";

import { CollectionContextMenuProvider } from "@renderer/context";
import { GameOptionsModalProvider } from "@renderer/context/game-options-modal/game-options-modal.context";

const App = React.lazy(() => import("./app").then(m => ({ default: m.App })));

import { store } from "./store";

import resources from "@locales";

import { logger } from "./logger";
import { addCookieInterceptor } from "./cookies";
import { clearStateFromPreviousSession } from "./session-state";
import * as Sentry from "@sentry/react";
import { ErrorBoundary } from "./components/error-boundary/error-boundary";
import { levelDBService } from "./services/leveldb.service";
const Catalogue = React.lazy(() => import("./pages/catalogue/catalogue"));
const CatalogueDiscover = React.lazy(() => import("./pages/catalogue/catalogue-discover"));
const CatalogueLayout = React.lazy(() => import("./pages/catalogue/catalogue-layout").then(m => ({ default: m.CatalogueLayout })));
const CatalogueTagsPage = React.lazy(() => import("./pages/catalogue/catalogue-categories").then(m => ({ default: m.CatalogueTagsPage })));
const CatalogueTopPage = React.lazy(() => import("./pages/catalogue/catalogue-wishlist-and-top").then(m => ({ default: m.CatalogueTopPage })));
const CatalogueWishlistPage = React.lazy(() => import("./pages/catalogue/catalogue-wishlist-and-top").then(m => ({ default: m.CatalogueWishlistPage })));
const CatalogueCalendarPage = React.lazy(() => import("./pages/catalogue/catalogue-calendar").then(m => ({ default: m.CatalogueCalendarPage })));
const Home = React.lazy(() => import("./pages/home/home"));
const Downloads = React.lazy(() => import("./pages/downloads/downloads"));
const KrystaMultimedia = React.lazy(() => import("./pages/multimedia/krysta-multimedia"));
const GameDetails = React.lazy(() => import("./pages/game-details/game-details"));
const RecompilationPage = React.lazy(() => import("./pages/recompilation/recompilation-page"));
const Settings = React.lazy(() => import("./pages/settings/settings"));
const Profile = React.lazy(() => import("./pages/profile/profile"));
const Achievements = React.lazy(() => import("./pages/achievements/achievements"));
const ThemeEditor = React.lazy(() => import("./pages/theme-editor/theme-editor"));
const Library = React.lazy(() => import("./pages/library/library"));
const Notifications = React.lazy(() => import("./pages/notifications/notifications"));
const Shop = React.lazy(() => import("./pages/shop/shop"));
const Leaderboards = React.lazy(() => import("./pages/leaderboards/leaderboards"));
import { AchievementNotification } from "./pages/achievements/notification/achievement-notification";
import { AchievementNotificationOverlay } from "./components/achievements/notification/achievement-notification-overlay";
const GameLauncher = React.lazy(() => import("./pages/game-launcher/game-launcher"));
const FriendsWindow = React.lazy(() => import("./pages/friends-window/friends-window"));
const ChatWindow = React.lazy(() => import("./pages/chat-window/chat-window"));
const AuthWindow = React.lazy(() => import("./pages/auth-window/auth-window"));
const RetroAchievementsConnectionWindow = React.lazy(() => import("./pages/retroachievements-connection-window/retroachievements-connection-window"));
const BigPictureApp = React.lazy(() => import("../../big-picture/src/app"));
const BigPictureCatalogue = React.lazy(() => import("../../big-picture/src/pages/catalogue/catalogue"));
const BigPictureComponentLab = React.lazy(() => import("../../big-picture/src/pages/component-lab/component-lab"));
const BigPictureDownloads = React.lazy(() => import("../../big-picture/src/pages/downloads/downloads"));
const BigPictureHome = React.lazy(() => import("../../big-picture/src/pages/home/home"));
const BigPictureSettings = React.lazy(() => import("../../big-picture/src/pages/settings/settings"));
const BigPictureLibrary = React.lazy(() => import("../../big-picture/src/pages/library/page"));
const BigPictureGame = React.lazy(() => import("../../big-picture/src/pages/game/game"));
const BigPictureGameAchievements = React.lazy(() => import("../../big-picture/src/pages/game-achievements/game-achievements"));
const BigPictureProfile = React.lazy(() => import("../../big-picture/src/pages/profile/profile"));

console.log = logger.log;

Sentry.init({
  dsn: import.meta.env.RENDERER_VITE_SENTRY_DSN,
  integrations: [
    Sentry.browserTracingIntegration(),
  ],
  tracesSampleRate: 0.05,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  release: "hydra-launcher@" + (await globalThis.electron.getVersion()),
});

globalThis.addEventListener("unhandledrejection", (event) => {
  logger.error("Unhandled promise rejection", event.reason);
});

globalThis.addEventListener("error", (event) => {
  logger.error("Uncaught error", event.error ?? event.message);
});

const isStaging = await globalThis.electron.isStaging();
addCookieInterceptor(isStaging);

await clearStateFromPreviousSession();

const syncDocumentLanguage = (language: string) => {
  document.documentElement.lang = language;
  document.documentElement.dir = i18n.dir(language);
};

await i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    interpolation: {
      escapeValue: false,
    },
  });

const userPreferences = (await levelDBService.get(
  "userPreferences",
  null,
  "json"
)) as { language?: string } | null;

if (userPreferences?.language) {
  await i18n.changeLanguage(userPreferences.language);
} else {
  globalThis.electron.updateUserPreferences({ language: i18n.language });
}

syncDocumentLanguage(i18n.language);
i18n.on("languageChanged", syncDocumentLanguage);

// Every BrowserWindow runs its own renderer with its own i18n instance, so a
// language change must be applied per-window. Subscribe here (the shared entry
// for all routes) so detached windows — friends, game-launcher, etc. — react
// too, not just the routes mounted under <App />.
globalThis.electron.onUserPreferencesUpdated((preferences) => {
  if (preferences?.language && preferences.language !== i18n.language) {
    i18n.changeLanguage(preferences.language).catch((error) => {
      console.error("Failed to change language", error);
    });
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Provider store={store}>
      <ErrorBoundary>
        <HashRouter>
          <CollectionContextMenuProvider>
            <GameOptionsModalProvider>
              <AchievementNotificationOverlay />
              <React.Suspense fallback={<div role="status" aria-busy="true" style={{ flex: 1, minHeight: 0 }} />}>
              <Routes>
                <Route element={<App />}>
                  <Route path="/" element={<Home />} />
                  <Route path="/catalogue" element={<CatalogueLayout />}>
                    <Route index element={<CatalogueDiscover />} />
                    <Route path="search" element={<Catalogue />} />
                    <Route path="tags" element={<CatalogueTagsPage />} />
                    <Route
                      path="wishlist"
                      element={<CatalogueWishlistPage />}
                    />
                    <Route path="top" element={<CatalogueTopPage />} />
                    <Route
                      path="releases"
                      element={<CatalogueCalendarPage />}
                    />
                  </Route>
                  <Route path="/library" element={<Library />} />
                  <Route path="/downloads" element={<Downloads />} />
                  <Route path="/multimedia" element={<KrystaMultimedia />} />
                  <Route
                    path="/recordings"
                    element={
                      <Navigate to="/multimedia?tab=recordings" replace />
                    }
                  />
                  <Route
                    path="/screenshots"
                    element={
                      <Navigate to="/multimedia?tab=screenshots" replace />
                    }
                  />
                  <Route
                    path="/game/:shop/:objectId"
                    element={<GameDetails />}
                  />
                  <Route
                    path="/recompilation/:objectId/:slug"
                    element={<RecompilationPage />}
                  />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/profile/:userId" element={<Profile />} />
                  <Route path="/achievements" element={<Achievements />} />
                  <Route path="/notifications" element={<Notifications />} />
                  <Route path="/shop" element={<Shop />} />
                  <Route path="/leaderboards" element={<Leaderboards />} />
                </Route>

                <Route path="/theme-editor" element={<ThemeEditor />} />
                <Route
                  path="/achievement-notification"
                  element={<AchievementNotification />}
                />
                <Route path="/game-launcher" element={<GameLauncher />} />
                <Route path="/friends-window" element={<FriendsWindow />} />
                <Route path="/chat-window" element={<ChatWindow />} />
                <Route path="/auth-window" element={<AuthWindow />} />
                <Route
                  path="/retroachievements-connection"
                  element={<RetroAchievementsConnectionWindow />}
                />

                <Route path="/big-picture" element={<BigPictureApp />}>
                  <Route index element={<BigPictureHome />} />
                  <Route path="catalogue" element={<BigPictureCatalogue />} />
                  <Route
                    path="component-lab"
                    element={<BigPictureComponentLab />}
                  />
                  <Route path="downloads" element={<BigPictureDownloads />} />
                  <Route path="settings" element={<BigPictureSettings />} />
                  <Route path="library" element={<BigPictureLibrary />} />
                  <Route
                    path="profile/:userId?"
                    element={<BigPictureProfile />}
                  />
                  <Route
                    path="game/:shop/:objectId"
                    element={<BigPictureGame />}
                  />
                  <Route
                    path="game/:shop/:objectId/achievements"
                    element={<BigPictureGameAchievements />}
                  />
                </Route>
              </Routes>
              </React.Suspense>
            </GameOptionsModalProvider>
          </CollectionContextMenuProvider>
        </HashRouter>
      </ErrorBoundary>
    </Provider>
  </React.StrictMode>
);
