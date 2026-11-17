import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Camera, Film } from "lucide-react";
import KrystaRecordings from "../recordings/krysta-recordings";
import KrystaScreenshots from "../screenshots/krysta-screenshots";
import "./krysta-media.scss";

/** One library entry and two clearly separated galleries. Hidden galleries
 * unmount, so they do not keep polling or playing media in the background. */
export default function KrystaMedia() {
  const [params, setParams] = useSearchParams();
  const { i18n } = useTranslation();
  const pl = i18n.language.startsWith("pl");
  const tab = params.get("tab") === "recordings" ? "recordings" : "screenshots";
  const changeTab = (next: "screenshots" | "recordings") => {
    setParams({ tab: next }, { replace: true });
  };

  return (
    <div className="krysta-media">
      <header className="krysta-media__top">
        <h1>{pl ? "Nagrania i zrzuty ekranu" : "Recordings & screenshots"}</h1>
        <nav className="krysta-media__tabs" aria-label={pl ? "Rodzaj multimediów" : "Media type"}>
          <button type="button"
            aria-current={tab === "screenshots" ? "page" : undefined}
            className={tab === "screenshots" ? "krysta-media__tab krysta-media__tab--active" : "krysta-media__tab"}
            onClick={() => changeTab("screenshots")}>
            <Camera size={17}/> {pl ? "Zrzuty ekranu" : "Screenshots"}
          </button>
          <button type="button"
            aria-current={tab === "recordings" ? "page" : undefined}
            className={tab === "recordings" ? "krysta-media__tab krysta-media__tab--active" : "krysta-media__tab"}
            onClick={() => changeTab("recordings")}>
            <Film size={17}/> {pl ? "Nagrania" : "Recordings"}
          </button>
        </nav>
      </header>
      {tab === "screenshots" ? <KrystaScreenshots/> : <KrystaRecordings/>}
    </div>
  );
}
