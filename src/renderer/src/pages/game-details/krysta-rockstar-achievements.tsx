import { Trophy } from "lucide-react";
import { useTranslation } from "react-i18next";
import "./krysta-game-updates.scss";

/** Honest integration state until authenticated Social Club sync is wired. */
export function KrystaRockstarAchievements() {
  const { i18n } = useTranslation();
  const pl = i18n.language.startsWith("pl");
  return (
    <section className="krysta-updates" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <header className="krysta-updates__header">
        <h2><Trophy size={18} /> {pl ? "Osiągnięcia Rockstar Social Club" : "Rockstar Social Club achievements"}</h2>
      </header>
      <p role="status">
        {pl
          ? "Odczyt osiągnięć Rockstar jest w przygotowaniu. Krysta nie ma jeszcze autoryzowanego połączenia z Social Club. Nie pokazujemy zerowego postępu ani fikcyjnych odblokowań."
          : "Rockstar achievement sync is being prepared. Krysta is not yet authorized with Social Club. Zero progress or fictional unlocks will not be displayed."}
      </p>
    </section>
  );
}
