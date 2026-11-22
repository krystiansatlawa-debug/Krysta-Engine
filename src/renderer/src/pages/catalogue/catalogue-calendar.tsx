import { useCallback, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components";
import {
  CatalogueGameRow,
  CatalogueRequestStatus,
  useCatalogueRequest,
} from "./catalogue-extras";
import {
  loadCatalogueReleaseMonth,
  shiftCatalogueMonth,
} from "./catalogue-extras-data";
import { catalogueGameKey } from "./catalogue-wishlist";

function currentMonth() {
  const today = new Date();
  return new Date(Date.UTC(today.getFullYear(), today.getMonth(), 1));
}

export function CatalogueCalendarPage() {
  const { t, i18n } = useTranslation("home");
  const [month, setMonth] = useState(currentMonth);
  const [cursors, setCursors] = useState<number[]>([]);
  const cursor = cursors.at(-1);
  const load = useCallback(
    (signal: AbortSignal) => loadCatalogueReleaseMonth(month, cursor, signal),
    [month, cursor]
  );
  const { data, retry } = useCatalogueRequest(load);
  const monthLabel = new Intl.DateTimeFormat(i18n.language, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(month);
  const dateFormatter = new Intl.DateTimeFormat(i18n.language, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

  const changeMonth = (shift: number) => {
    setMonth((current) => shiftCatalogueMonth(current, shift));
    setCursors([]);
  };

  const nextCursor = data?.nextCursor;
  return (
    <section className="catalogue-extra">
      <header>
        <h1>{t("catalogue_calendar")}</h1>
        <p>{t("catalogue_calendar_basis")}</p>
      </header>
      <div className="catalogue-extra__calendar-controls">
        <Button
          size="small"
          theme="outline"
          aria-label={t("catalogue_calendar_prev_month")}
          onClick={() => changeMonth(-1)}
        >
          <ChevronLeftIcon />
        </Button>
        <h2 aria-live="polite">{monthLabel}</h2>
        <Button
          size="small"
          theme="outline"
          aria-label={t("catalogue_calendar_next_month")}
          onClick={() => changeMonth(1)}
        >
          <ChevronRightIcon />
        </Button>
        <Button
          size="small"
          theme="outline"
          onClick={() => {
            setMonth(currentMonth());
            setCursors([]);
          }}
        >
          {t("catalogue_calendar_current_month")}
        </Button>
      </div>
      {!data ? (
        <CatalogueRequestStatus loading={data === undefined} retry={retry} />
      ) : data.games.length > 0 ? (
        <ul className="catalogue-extra__games">
          {data.games.map(({ game, day }) => (
            <CatalogueGameRow
              game={game}
              key={catalogueGameKey(game)}
              prefix={
                <time className="catalogue-extra__date" dateTime={day}>
                  {dateFormatter.format(new Date(day + "T00:00:00.000Z"))}
                </time>
              }
            />
          ))}
        </ul>
      ) : (
        <p className="catalogue-extra__status">
          {t("catalogue_calendar_empty")}
        </p>
      )}

      {data && (cursors.length > 0 || nextCursor != null) && (
        <nav
          className="catalogue-extra__pagination"
          aria-label={t("catalogue_calendar_pages")}
        >
          <Button
            theme="outline"
            disabled={!cursors.length}
            onClick={() => setCursors((current) => current.slice(0, -1))}
          >
            {t("catalogue_calendar_previous")}
          </Button>
          <Button
            theme="outline"
            disabled={nextCursor == null}
            onClick={() => {
              if (nextCursor != null) {
                setCursors((current) => [...current, nextCursor]);
              }
            }}
          >
            {t("catalogue_calendar_next")}
          </Button>
        </nav>
      )}
    </section>
  );
}
