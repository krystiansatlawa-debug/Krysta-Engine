import { useTranslation } from "react-i18next";
import {
  SettingsContextConsumer,
  SettingsContextProvider,
} from "@renderer/context";
import { SettingsAccount } from "./settings-account";
import { useFeature, useUserDetails } from "@renderer/hooks";
import { Fragment, useMemo, useState } from "react";
import type { SettingsCategoryId } from "@renderer/context/settings/settings.context";
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
import { Camera, Gamepad2, Wrench, RefreshCw, SlidersHorizontal } from "lucide-react";
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
import { SettingsContextEmulation } from "./emulation/settings-context-emulation";

const BASIC_SETTINGS = new Set([
  "general", "downloads", "krysta_updates", "screenshots",
  "notifications", "krysta_cloud", "integrations", "account_privacy", "advanced",
]);
const ADVANCED_SETTINGS: SettingsCategoryId[] = [
  "download_sources", "content_gameplay", "game", "compatibility", "big_picture", "emulation",
];

export default function Settings() {
  const { t, i18n } = useTranslation("settings");
  const pl = i18n.language.startsWith("pl");
  const [categorySearch,setCategorySearch] = useState("");
  const [advancedCategoryId,setAdvancedCategoryId] = useState<SettingsCategoryId>("content_gameplay");

  const { userDetails } = useUserDetails();
  const { isFeatureEnabled, Feature } = useFeature();
  const isScreenshotsEnabled = isFeatureEnabled(Feature.Screenshots);

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
        id: "advanced" as const,
        label: pl ? "Zaawansowane" : "Advanced",
        icon: <SlidersHorizontal size={16} />,
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
      { id: "krysta_updates" as const, label: i18n.language.startsWith("pl") ? "Aktualizacje" : "Updates", icon: <RefreshCw size={16} /> },
      { id: "krysta_cloud" as const, label: "Krysta Cloud", icon: <CloudIcon size={16} /> },
      { id: "game" as const, label: t("krysta_game_category", { defaultValue: "Game" }), icon: <Gamepad2 size={16} /> },
      ...(isScreenshotsEnabled
        ? [
            {
              id: "screenshots" as const,
              label: t("screenshots_category"),
              icon: <Camera size={16} />,
            },
          ]
        : []),
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
    [t, i18n.language, userDetails, isScreenshotsEnabled, pl]
  );

  return (
    <SettingsContextProvider>
      <SettingsContextConsumer>
        {({ currentCategoryId, setCurrentCategoryId, appearance }) => {
          const currentCategory =
            categories.find((category) => category.id === currentCategoryId) ??
            categories[0];
          const selectedCategoryId = currentCategory.id;
          const effectiveCategoryId = selectedCategoryId === "advanced"
            ? advancedCategoryId : selectedCategoryId;
          const normalizedSearch=categorySearch.toLocaleLowerCase(i18n.language).trim();
          // Advanced categories never enter the main menu even when searching.
          const displayedCategories = categories.filter(category =>
            BASIC_SETTINGS.has(category.id) &&
            (!normalizedSearch ||
              category.label.toLocaleLowerCase(i18n.language).includes(normalizedSearch) ||
              (category.id === "advanced" && categories.some(child =>
                ADVANCED_SETTINGS.includes(child.id) &&
                child.label.toLocaleLowerCase(i18n.language).includes(normalizedSearch)
              )))
          );
          const advancedCategories=categories.filter(category =>
            ADVANCED_SETTINGS.includes(category.id) &&
            (!normalizedSearch || category.label.toLocaleLowerCase(i18n.language).includes(normalizedSearch))
          );

          const renderCategory = () => {
            if (effectiveCategoryId === "general") {
              return <SettingsContextGeneral appearance={appearance} />;
            }

            if (effectiveCategoryId === "downloads") {
              return <SettingsContextDownloads />;
            }

            if (effectiveCategoryId === "download_sources") {
              return <SettingsContextDownloadSources />;
            }

            if (effectiveCategoryId === "notifications") {
              return <SettingsContextNotifications />;
            }

            if (effectiveCategoryId === "content_gameplay") {
              return <SettingsContextContentGameplay />;
            }

            if (effectiveCategoryId === "krysta_updates") return <SettingsContextKrystaUpdates />;
            if (effectiveCategoryId === "krysta_cloud") return <SettingsContextKrystaCloud />;
            if (effectiveCategoryId === "game") return <SettingsContextGame />;

            if (effectiveCategoryId === "screenshots") {
              return <SettingsContextScreenshots />;
            }

            if (effectiveCategoryId === "integrations") {
              return <SettingsContextIntegrations />;
            }

            if (effectiveCategoryId === "compatibility") {
              return <SettingsContextCompatibility />;
            }

            if (effectiveCategoryId === "big_picture") {
              return <SettingsContextBigPicture />;
            }

            if (effectiveCategoryId === "emulation") {
              return <SettingsContextEmulation />;
            }

            return <SettingsAccount />;
          };

          return (
            <section className="settings__container">
              <div className="settings__content">
                <aside className="settings__sidebar">
                  <label className="settings__sidebar-search-label" htmlFor="krysta-settings-search">{pl?"Znajdź ustawienie":"Find a setting"}</label>
                  <input id="krysta-settings-search" type="search" className="settings__sidebar-search" value={categorySearch} onChange={e=>setCategorySearch(e.target.value)} placeholder={pl?"Szukaj kategorii…":"Search categories…"} />
                  {!displayedCategories.length&&<p className="settings__sidebar-empty">{pl?"Brak wyników":"No matching settings"}</p>}
                  {displayedCategories.map((category, index) => {
                    const prevGroup =
                      index > 0
                        ? (displayedCategories[index - 1] as { group?: string }).group
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
                  {selectedCategoryId === "advanced" && (
                    <nav className="settings__advanced-tabs" aria-label={pl?"Kategorie zaawansowane":"Advanced settings sections"}>
                      <p>{pl?"Dodatkowe ustawienia są tutaj, oddzielone od podstawowych opcji.":"Extra options are here, separate from basic settings."}</p>
                      <div className="settings__advanced-tab-list">
                        {advancedCategories.map(category=>(
                          <button key={category.id} type="button"
                            className={`settings__advanced-tab ${advancedCategoryId===category.id?"settings__advanced-tab--active":""}`}
                            aria-current={advancedCategoryId===category.id?"page":undefined}
                            onClick={()=>setAdvancedCategoryId(category.id)}>
                            {category.icon} {category.label}
                          </button>
                        ))}
                      </div>
                    </nav>
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
