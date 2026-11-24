import { useContext, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CheckIcon, XIcon } from "@primer/octicons-react";
import { gameDetailsContext } from "@renderer/context/game-details/game-details.context";
import { SidebarSection } from "../sidebar-section/sidebar-section";
import "./game-language-section.scss";

export function GameLanguageSection() {
  const { t, i18n } = useTranslation("game_details");
  const pl = i18n.language.startsWith("pl");
  const { shopDetails } = useContext(gameDetailsContext);

  const languages = useMemo(() => {
    const supportedLanguages = shopDetails?.supported_languages;
    if (!supportedLanguages) return [];

    const languagesString = supportedLanguages.split(/<br\s*\/?\s*>/i)[0];
    const languageArray = languagesString?.split(",") || [];

    return languageArray.map((lang) => ({
      language: lang.replace(/<[^>]*>/g, "").replaceAll("*", "").trim(),
      hasAudio: lang.includes("*"),
    })).filter(lang => lang.language.length > 0);
  }, [shopDetails?.supported_languages]);

  if (languages.length === 0) {
    return null;
  }

  return (
    <SidebarSection title={t("language")}>
      {languages.some(l => /^(polish|polski)$/i.test(l.language)) && <p>{languages.some(l => /^(polish|polski)$/i.test(l.language) && l.hasAudio) ? (pl ? "Polski: pełne audio według danych sklepu" : "Polish: full audio listed") : (pl ? "Polski: język dostępny, brak oznaczenia pełnego audio" : "Polish listed, full audio not indicated")}</p>}
      <div className="game-language-section">
        <div className="game-language-section__header">
          <div className="game-language-section__header-item">
            <span>{t("language")}</span>
          </div>
          <div className="game-language-section__header-item game-language-section__header-item--center">
            <span>{pl ? "Dostępny" : "Listed"}</span>
          </div>
          <div className="game-language-section__header-item game-language-section__header-item--center">
            <span>{t("audio")}</span>
          </div>
        </div>

        <div className="game-language-section__content">
          {languages.map((lang) => (
            <div key={lang.language} className="game-language-section__row">
              <div
                className="game-language-section__cell game-language-section__cell--language"
                title={lang.language}
              >
                {lang.language}
              </div>
              <div className="game-language-section__cell game-language-section__cell--center">
                <CheckIcon size={14} className="game-language-section__check" />
              </div>
              <div className="game-language-section__cell game-language-section__cell--center">
                {lang.hasAudio ? (
                  <CheckIcon
                    size={14}
                    className="game-language-section__check"
                  />
                ) : (
                  <XIcon size={14} className="game-language-section__cross" />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </SidebarSection>
  );
}
