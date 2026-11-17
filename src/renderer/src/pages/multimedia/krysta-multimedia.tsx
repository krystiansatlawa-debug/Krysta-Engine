import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Camera, Film } from "lucide-react";
import KrystaRecordings from "../recordings/krysta-recordings";
import KrystaScreenshots from "../screenshots/krysta-screenshots";
import "./krysta-multimedia.scss";

export default function KrystaMultimedia() {
  const { i18n } = useTranslation();
  const pl = i18n.language.startsWith("pl");
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "recordings" ? "recordings" : "screenshots";

  const changeTab = (next: "screenshots" | "recordings") => {
    setParams({ tab: next }, { replace: true });
  };

  return (
    <div className="krysta-multimedia">
      <nav className="krysta-multimedia__tabs" aria-label={pl ? "Multimedia" : "Media"}>
        <button type="button" className={tab === "screenshots" ? "active" : ""}
          aria-current={tab === "screenshots" ? "page" : undefined}
          onClick={() => changeTab("screenshots")}>
          <Camera size={18} />{pl ? "Zrzuty ekranu" : "Screenshots"}
        </button>
        <button type="button" className={tab === "recordings" ? "active" : ""}
          aria-current={tab === "recordings" ? "page" : undefined}
          onClick={() => changeTab("recordings")}>
          <Film size={18} />{pl ? "Nagrania" : "Recordings"}
        </button>
      </nav>
      {tab === "screenshots" ? <KrystaScreenshots /> : <KrystaRecordings />}
    </div>
  );
}
