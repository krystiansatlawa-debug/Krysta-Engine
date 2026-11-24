import { useTranslation } from "react-i18next";
import {
  SettingsContextConsumer,
  SettingsContextProvider,
} from "@renderer/context";
import { SettingsAccount } from "./settings-account";
import { useUserDetails } from "@renderer/hooks";
import { Fragment, useMemo, useState } from "react";
import "./settings.scss";
import {
  BellIcon,
  CloudIcon,
  DownloadIcon,
  GearIcon,
  LinkIcon,
  PlayIcon,
  VideoIcon,
  ShieldCheckIcon,
} from "@primer/octicons-react";
import { Camera, Gamepad2, Wrench, RefreshCw } from "lucide-react";
import { SettingsContextKrystaUpdates } from "./settings-context-krysta-updates";
import { SettingsContextKrystaCloud } from "./settings-context-krysta-cloud";
import { SettingsContextGame } from "./settings-context-game";
import { SettingsContextGeneral } from "./settings-context-general";
import { SettingsContextDownloads } from "./settings-context-downloads";
import { SettingsContextDownloadSources } from "./settings-context-download-sources";
import { SettingsContextNotifications } from "./settings-context-notifications";
import { SettingsContextContentGameplay } from "./settings-context-content-gameplay";
import { SettingsContextScreenshots } from "./settings-context-screenshots";
import { SettingsContextIntegrations } from "./settings-context-integrations";
import { SettingsContextCompatibility } from "./settings-context-compatibility";
import { SettingsContextBigPicture } from "./settings-context-big-picture";
import { SettingsContextControllers } from "./settings-context-controllers";
import { SettingsContextEmulation } from "./emulation/settings-context-emulation";

const BASIC_SETTINGS = new Set([
  "general",
  "game",
  "downloads",
  "krysta_updates",
  "screenshots",
  "controllers",
  "notifications",
  "krysta_cloud",
  "integrations",
  "account_privacy",
]);
const ADVANCED_VISIBILITY_KEY = "krysta.settings.show-advanced";

export default function Settings() {
  const { t, i18n } = useTranslation("settings");
  const pl = i18n.language.startsWith("pl");
  const [showAdvanced, setShowAdvanced] = useState<boolean>(() => {
    try {
      return localStorage.getItem(ADVANCED_VISIBILITY_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [categorySearch, setCategorySearch] = useState("");
  const changeAdvanced = (next: boolean) => {
    setShowAdvanced(next);
    try {
      localStorage.setItem(ADVANCED_VISIBILITY_KEY, String(next));
    } catch {
      // The in-memory preference still applies if storage is unavailable.
    }
  };

  const { userDetails } = useUserDetails();

  const categories = useMemo(
    () => [
      {
        id: "general" as const,
        label: t("general"),
        icon: <GearIcon size={16} />,
      },
      {
        id: "downloads" as const,
        label: t("downloads"),
        icon: <DownloadIcon size={16} />,
      },
      {
        id: "download_sources" as const,
        label: t("download_sources"),
        icon: <LinkIcon size={16} />,
      },
      {
        id: "notifications" as const,
        label: t("notifications"),
        icon: <BellIcon size={16} />,
      },
      {
        id: "content_gameplay" as const,
        label: t("content_gameplay"),
        icon: <PlayIcon size={16} />,
      },
      {
        id: "krysta_updates" as const,
        label: i18n.language.startsWith("pl") ? "Aktualizacje" : "Updates",
        icon: <RefreshCw size={16} />,
      },
      {
        id: "krysta_cloud" as const,
        label: "Krysta Cloud",
        icon: <CloudIcon size={16} />,
      },
      {
        id: "game" as const,
        label: t("krysta_game_category", { defaultValue: "Game" }),
        searchLabel: t("game_boost_heading"),
        icon: <Gamepad2 size={16} />,
      },
      {
        id: "controllers" as const,
        label: t("controller_configuration.title"),
        icon: <Gamepad2 size={16} />,
      },
      {
        id: "screenshots" as const,
        label: pl ? "Multimedia" : "Media",
        icon: <Camera size={16} />,
      },
      {
        id: "integrations" as const,
        label: t("integrations"),
        icon: <CloudIcon size={16} />,
      },
      {
        id: "compatibility" as const,
        label: t("compatibility"),
        icon: <Wrench size={16} />,
      },
      ...(userDetails
        ? [
            {
              id: "account_privacy" as const,
              label: `${t("account")} & ${t("privacy")}`,
              icon: <ShieldCheckIcon size={16} />,
            },
          ]
        : []),
      {
        id: "big_picture" as const,
        label: t("big_picture"),
        icon: <VideoIcon size={16} />,
      },
      {
        id: "emulation" as const,
        label: t("emulation"),
        icon: <Gamepad2 size={16} />,
        group: "classics" as const,
      },
    ],
    [t, i18n.language, userDetails, pl]
  );

  return (
    <SettingsContextProvider>
      <SettingsContextConsumer>
        {({ currentCategoryId, setCurrentCategoryId, appearance }) => {
          const currentCategory =
            categories.find((category) => category.id === currentCategoryId) ??
            categories[0];
          const selectedCategoryId = currentCategory.id;
          const search = categorySearch.toLocaleLowerCase(i18n.language);
          const searchedCategories = categories.filter(
            (category) =>
              category.label
                .toLocaleLowerCase(i18n.language)
                .includes(search) ||
              ("searchLabel" in category &&
                category.searchLabel
                  ?.toLocaleLowerCase(i18n.language)
                  .includes(search))
          );
          const displayedCategories = searchedCategories.filter(
            (category) =>
              categorySearch.trim().length > 0 ||
              showAdvanced ||
              BASIC_SETTINGS.has(category.id) ||
              category.id === selectedCategoryId
          );
          const hiddenCategories =
            categories.length - displayedCategories.length;

          const renderCategory = () => {
            if (selectedCategoryId === "general") {
              return <SettingsContextGeneral appearance={appearance} />;
            }

            if (selectedCategoryId === "downloads") {
              return <SettingsContextDownloads />;
            }

            if (selectedCategoryId === "download_sources") {
              return <SettingsContextDownloadSources />;
            }

            if (selectedCategoryId === "notifications") {
              return <SettingsContextNotifications />;
            }

            if (selectedCategoryId === "content_gameplay") {
              return <SettingsContextContentGameplay />;
            }

            if (selectedCategoryId === "krysta_updates")
              return <SettingsContextKrystaUpdates />;
            if (selectedCategoryId === "krysta_cloud")
              return <SettingsContextKrystaCloud />;
            if (selectedCategoryId === "game") return <SettingsContextGame />;

            if (selectedCategoryId === "controllers") {
              return <SettingsContextControllers />;
            }

            if (selectedCategoryId === "screenshots") {
              return <SettingsContextScreenshots />;
            }

            if (selectedCategoryId === "integrations") {
              return <SettingsContextIntegrations />;
            }

            if (selectedCategoryId === "compatibility") {
              return <SettingsContextCompatibility />;
            }

            if (selectedCategoryId === "big_picture") {
              return <SettingsContextBigPicture />;
            }

            if (selectedCategoryId === "emulation") {
              return <SettingsContextEmulation />;
            }

            return <SettingsAccount />;
          };

          return (
            <section className="settings__container">
              <div className="settings__content">
                <aside className="settings__sidebar">
                  <label
                    className="settings__sidebar-search-label"
                    htmlFor="krysta-settings-search"
                  >
                    {pl ? "Znajdź ustawienie" : "Find a setting"}
                  </label>
                  <input
                    id="krysta-settings-search"
                    type="search"
                    className="settings__sidebar-search"
                    value={categorySearch}
                    onChange={(e) => setCategorySearch(e.target.value)}
                    placeholder={
                      pl ? "Szukaj kategorii…" : "Search categories…"
                    }
                  />
                  <button
                    type="button"
                    className="settings__sidebar-expand"
                    aria-expanded={showAdvanced}
                    onClick={() => changeAdvanced(!showAdvanced)}
                  >
                    {showAdvanced
                      ? pl
                        ? "Pokaż mniej opcji"
                        : "Show fewer options"
                      : pl
                        ? "Pokaż zaawansowane"
                        : "Show advanced settings"}
                    {!showAdvanced && hiddenCategories > 0 && (
                      <span aria-hidden="true"> ({hiddenCategories})</span>
                    )}
                  </button>
                  {!displayedCategories.length && (
                    <p className="settings__sidebar-empty">
                      {pl ? "Brak wyników" : "No matching settings"}
                    </p>
                  )}
                  {displayedCategories.map((category, index) => {
                    const prevGroup =
                      index > 0
                        ? (displayedCategories[index - 1] as { group?: string })
                            .group
                        : undefined;
                    const currentGroup = (category as { group?: string }).group;
                    const showGroupHeader =
                      currentGroup && currentGroup !== prevGroup;

                    return (
                      <Fragment key={category.id}>
                        {showGroupHeader && (
                          <div className="settings__sidebar-group">
                            <div className="settings__sidebar-divider" />
                            <span className="settings__sidebar-group-label">
                              {currentGroup === "classics"
                                ? t("classics_group")
                                : currentGroup}
                            </span>
                          </div>
                        )}
                        <button
                          type="button"
                          className={`settings__sidebar-button ${
                            currentCategory.id === category.id
                              ? "settings__sidebar-button--active"
                              : ""
                          }`}
                          onClick={() => setCurrentCategoryId(category.id)}
                        >
                          <span className="settings__sidebar-button-icon">
                            {category.icon}
                          </span>
                          <span className="settings__sidebar-button-label">
                            {category.label}
                          </span>
                        </button>
                      </Fragment>
                    );
                  })}
                </aside>

                <div className="settings__panel">
                  {selectedCategoryId !== "emulation" && (
                    <h2>{currentCategory.label}</h2>
                  )}
                  {renderCategory()}
                </div>
              </div>
            </section>
          );
        }}
      </SettingsContextConsumer>
    </SettingsContextProvider>
  );
}
