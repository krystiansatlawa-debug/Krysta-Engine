import type { CSSProperties } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { RefreshCw, Film } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DashIcon,
  ScreenFullIcon,
  ScreenNormalIcon,
  VideoIcon,
  XIcon,
} from "@primer/octicons-react";
import cn from "classnames";

import { MAIN_WINDOW_TITLE_BAR_HEIGHT } from "@shared";

import { NavigationArrows } from "../navigation-arrows/navigation-arrows";
import { TitleBarSearch } from "./title-bar-search";
import {
  useKrystaPendingPatches,
  findKrystaPendingPatch,
} from "../../pages/library/krysta-patch-badge";
import { useAppSelector } from "@renderer/hooks";
import { selectGroupedLibrary } from "@renderer/features";
import "./app-title-bar.scss";
import "./title-bar-search.scss";

const titleBarStyle = {
  "--title-bar-height": `${MAIN_WINDOW_TITLE_BAR_HEIGHT}px`,
} as CSSProperties;

export interface AppTitleBarProps {
  hasActiveSubscription: boolean;
  version: string;
  isWindowMaximized: boolean;
}

/**
 * The main window's only bar: brand and version over the sidebar, back and
 * forward where the pages start, search in the middle, and the window
 * controls each platform needs.
 */
export function AppTitleBar({
  hasActiveSubscription,
  version,
  isWindowMaximized,
}: Readonly<AppTitleBarProps>) {
  const { t, i18n } = useTranslation(["header", "sidebar"]);
  const location = useLocation();
  const updatesSelected =
    location.pathname === "/library" &&
    new URLSearchParams(location.search).get("collection") ===
      "__krysta_updates__";
  const patches = useKrystaPendingPatches();
  const games = useAppSelector(selectGroupedLibrary);
  const patchCount = games.filter((game) =>
    Boolean(findKrystaPendingPatch(game, patches))
  ).length;
  const pl = i18n.language.startsWith("pl");
  const updatesLabel = pl ? "Gry z nowymi patchami" : "Games with new patches";

  const { platform, hasNativeWindowDecorations } = window.electron;

  // The system draws the window frame and title on macOS and on Linux with
  // native decorations, so only Hydra's own frame shows the name.
  const hasCustomFrame =
    platform === "win32" ||
    (platform === "linux" && !hasNativeWindowDecorations);
  const hasCustomWindowControls =
    platform === "linux" && !hasNativeWindowDecorations;

  return (
    <header
      className={cn("title-bar", {
        "title-bar--windows": platform === "win32",
        "title-bar--darwin": platform === "darwin",
      })}
      style={titleBarStyle}
    >
      <div className="title-bar__brand">
        {hasCustomFrame && (
          <h4>
            <span className="krysta-mark" aria-hidden="true">
              K
            </span>{" "}
            Krysta
            {hasActiveSubscription && (
              <span className="title-bar__cloud-text"> Cloud</span>
            )}
          </h4>
        )}

        {version && (
          <button
            type="button"
            data-open-workwonders-changelog-mini
            className="title-bar__version"
          >
            v{version}
          </button>
        )}
      </div>

      <NavigationArrows className="title-bar__navigation" />
      <nav className="krysta-top-nav">
        <NavLink
          to="/recordings"
          className={({ isActive }) => (isActive ? "active" : "")}
          title={pl ? "Nagrania" : "Recordings"}
        >
          <Film size={17} />
          <span>{pl ? "Nagrania" : "Recordings"}</span>
        </NavLink>
        <Link
          to="/library?collection=__krysta_updates__"
          className={updatesSelected ? "active" : ""}
          aria-current={updatesSelected ? "page" : undefined}
          title={updatesLabel}
          aria-label={updatesLabel + " (" + patchCount + ")"}
        >
          <RefreshCw size={17} />
          <span>
            {updatesLabel} ({patchCount})
          </span>
        </Link>
      </nav>

      <div className="title-bar__search">
        {!location.pathname.startsWith("/catalogue") && <TitleBarSearch />}
      </div>

      <button
        type="button"
        className="title-bar__big-picture"
        onClick={() => window.electron.openBigPictureWindow()}
      >
        <VideoIcon size={14} />
        {t("big_picture", { ns: "sidebar" })}
      </button>

      {hasCustomWindowControls && (
        <div className="title-bar__window-controls">
          <button
            type="button"
            className="title-bar__window-control"
            onClick={() => window.electron.minimizeMainWindow()}
            title={t("minimize")}
            aria-label={t("minimize")}
          >
            <DashIcon size={16} />
          </button>
          <button
            type="button"
            className="title-bar__window-control"
            onClick={() => window.electron.toggleMaximizeMainWindow()}
            title={isWindowMaximized ? t("restore") : t("maximize")}
            aria-label={isWindowMaximized ? t("restore") : t("maximize")}
          >
            {isWindowMaximized ? (
              <ScreenNormalIcon size={16} />
            ) : (
              <ScreenFullIcon size={16} />
            )}
          </button>
          <button
            type="button"
            className="title-bar__window-control title-bar__window-control--close"
            onClick={() => window.electron.closeMainWindow()}
            title={t("close")}
            aria-label={t("close")}
          >
            <XIcon size={16} />
          </button>
        </div>
      )}
    </header>
  );
}
