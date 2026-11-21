import { useEffect, useState } from "react";
import { HistoryIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";

import { Button } from "@renderer/components";
import { useDate } from "@renderer/hooks";
import type { GameJournalPage } from "@types";
import "./game-journal.scss";

const PAGE_SIZE = 20;

export function GameJournal({ gameKeys }: Readonly<{ gameKeys: string[] }>) {
  const { t } = useTranslation("game_details");
  const { formatDateTime } = useDate();
  const [page, setPage] = useState<GameJournalPage | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [reload, setReload] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let requestId = 0;
    const load = async () => {
      const id = ++requestId;
      setIsLoading(true);
      setHasError(false);
      try {
        const result = await window.electron.getGameJournal(gameKeys, limit);
        if (!cancelled && id === requestId) setPage(result);
      } catch {
        if (!cancelled && id === requestId) setHasError(true);
      } finally {
        if (!cancelled && id === requestId) setIsLoading(false);
      }
    };

    const unsubscribe = window.electron.onGameJournalChanged((gameKey) => {
      if (gameKeys.includes(gameKey)) void load();
    });
    void load();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [gameKeys, limit, reload]);

  const formatDuration = (startedAt: number, endedAt: number) => {
    const seconds = Math.floor((endedAt - startedAt) / 1000);
    if (seconds < 60) return t("journal_duration_seconds", { seconds });
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds / 60) % 60;
    return hours
      ? t("journal_duration_hours", { hours, minutes })
      : t("journal_duration_minutes", { minutes });
  };

  return (
    <section className="game-journal" aria-labelledby="game-journal-heading">
      <h2 id="game-journal-heading" className="game-journal__heading">
        <span className="game-journal__icon">
          <HistoryIcon size={20} />
        </span>
        {t("journal_sessions")}
      </h2>
      <div className="game-journal__content" aria-busy={isLoading}>
        {hasError && (
          <div className="game-journal__error">
            <p role="alert">{t("journal_load_error")}</p>
            <Button
              theme="outline"
              onClick={() => setReload((value) => value + 1)}
            >
              {t("journal_retry")}
            </Button>
          </div>
        )}
        {page?.sessions.length ? (
          <div className="game-journal__table-wrapper">
            <table className="game-journal__table">
              <thead>
                <tr>
                  <th scope="col">{t("journal_started")}</th>
                  <th scope="col">{t("journal_ended")}</th>
                  <th scope="col">{t("journal_duration")}</th>
                </tr>
              </thead>
              <tbody>
                {page.sessions.map(({ id, startedAt, endedAt }) => (
                  <tr key={id}>
                    <td>
                      <time dateTime={new Date(startedAt).toISOString()}>
                        {formatDateTime(startedAt)}
                      </time>
                    </td>
                    <td>
                      <time dateTime={new Date(endedAt).toISOString()}>
                        {formatDateTime(endedAt)}
                      </time>
                    </td>
                    <td>{formatDuration(startedAt, endedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !hasError && (
            <p className="game-journal__message" role="status">
              {t(isLoading ? "journal_loading" : "journal_empty")}
            </p>
          )
        )}
      </div>
      {page?.hasMore && (
        <Button
          className="game-journal__more"
          theme="outline"
          disabled={isLoading || hasError}
          onClick={() => setLimit((value) => value + PAGE_SIZE)}
        >
          {t("journal_older")}
        </Button>
      )}
    </section>
  );
}
