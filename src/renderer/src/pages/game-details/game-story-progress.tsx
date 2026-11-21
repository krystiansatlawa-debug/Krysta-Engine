import { useEffect, useId, useLayoutEffect, useState } from "react";
import type { FormEvent } from "react";
import { BookIcon, PencilIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";

import { Button, ProgressBar, TextField } from "@renderer/components";
import { useDate } from "@renderer/hooks/use-date";
import type {
  GameShop,
  GameStoryProgressView,
  GameStoryProgress as StoryProgress,
} from "@types";
import {
  STORY_MISSION_DESCRIPTION_LIMIT,
  STORY_MISSION_NAME_LIMIT,
} from "../../../../shared/game-story-progress";
import { storyProgressCardRegistry } from "./story-progress-card-registry";
import "./game-story-progress.scss";

interface GameStoryProgressProps {
  shop: GameShop;
  objectId: string;
}

function StoryMeter({
  percent,
  label,
}: Readonly<{ percent: number; label: string }>) {
  const { i18n } = useTranslation();
  return (
    <div className="game-story-progress__meter">
      <div className="game-story-progress__meter-heading">
        <span>{label}</span>
        <strong>
          {new Intl.NumberFormat(i18n.language, {
            style: "percent",
            maximumFractionDigits: 2,
          }).format(percent / 100)}
        </strong>
      </div>
      <ProgressBar
        now={percent}
        max={100}
        label={label}
        completed={percent === 100}
        trackClassName="game-story-progress__track"
        barClassName="game-story-progress__bar"
      />
    </div>
  );
}

export function GameStoryProgress({
  shop,
  objectId,
}: Readonly<GameStoryProgressProps>) {
  const { t } = useTranslation("game_details");
  const { formatDateTime } = useDate();
  const headingId = useId();
  const descriptionId = useId();
  const gameKey = `${shop}:${objectId}`;
  const [primaryCardKey, setPrimaryCardKey] = useState<string | null>(null);
  useLayoutEffect(
    () =>
      storyProgressCardRegistry.register(gameKey, (primary) =>
        setPrimaryCardKey(primary ? gameKey : null)
      ),
    [gameKey]
  );
  const isPrimary = primaryCardKey === gameKey;
  const [progress, setProgress] = useState<StoryProgress | null>(null);
  const [saveView, setSaveView] = useState<
    Omit<GameStoryProgressView, "manual">
  >({
    automatic: null,
    automaticStatus: "not-found",
    lastSaveAt: null,
    hasCustomSaveFolder: false,
    canSelectSaveFolder: false,
  });
  const {
    automatic,
    automaticStatus,
    hasCustomSaveFolder,
    canSelectSaveFolder,
  } = saveView;
  const lastSaveAt = saveView.lastSaveAt ?? automatic?.savedAt ?? null;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [selectingFolder, setSelectingFolder] = useState(false);
  const [folderError, setFolderError] = useState(false);

  useEffect(() => {
    // Only the visible card subscribes and reads saves. Duplicate mounts do not
    // trigger extra disk scans or accumulate listeners.
    if (!isPrimary) return;
    let active = true;
    let initialScan: number | undefined;
    window.electron
      .getGameStoryProgress(shop, objectId, reload > 0)
      .then((value) => {
        if (!active) return;
        setProgress(value.manual);
        setSaveView(value);
        if (!reload && value.automaticStatus === "not-found") {
          // Load cached data first and skip the scan when browsing past this card.
          initialScan = window.setTimeout(() => {
            void window.electron
              .getGameStoryProgress(shop, objectId, true)
              .then((scanned) => {
                if (active) setSaveView(scanned);
              })
              .catch(() => {});
          }, 800);
        }
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const unsubscribe = window.electron.onGameStoryProgressChanged(() => {
      window.electron
        .getGameStoryProgress(shop, objectId, false)
        .then((value) => {
          if (!active) return;
          setSaveView(value);
        })
        .catch(() => {});
    });
    return () => {
      active = false;
      window.clearTimeout(initialScan);
      unsubscribe();
    };
  }, [shop, objectId, reload, isPrimary]);

  const retryLoad = () => {
    setLoadError(false);
    setLoading(true);
    setReload((value) => value + 1);
  };

  const chooseSaveFolder = async (reset = false) => {
    setSelectingFolder(true);
    setFolderError(false);
    try {
      const value = await window.electron.selectStorySaveFolder(
        shop,
        objectId,
        reset
      );
      if (value) setSaveView(value);
    } catch {
      setFolderError(true);
    } finally {
      setSelectingFolder(false);
    }
  };

  const saveProgress = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;

    const fields = new FormData(event.currentTarget);
    const percent = String(fields.get("percent") ?? "");
    setSaving(true);
    setSaveError(false);
    try {
      const result = await window.electron.setGameStoryProgress(
        shop,
        objectId,
        {
          percent: percent ? Number(percent) : null,
          missionName: String(fields.get("missionName") ?? ""),
          missionDescription: String(fields.get("missionDescription") ?? ""),
        }
      );
      setProgress(result);
      setEditing(false);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  if (!isPrimary) return null;

  return (
    <section className="game-story-progress" aria-labelledby={headingId}>
      <header className="game-story-progress__header">
        <h2 id={headingId}>
          <span className="game-story-progress__icon" aria-hidden="true">
            <BookIcon size={16} />
          </span>
          {t("story_progress_heading")}
        </h2>
        {!loading && !loadError && !editing && (
          <Button
            theme="outline"
            size="small"
            onClick={() => {
              setSaveError(false);
              setEditing(true);
            }}
          >
            <PencilIcon size={14} />
            {t(progress ? "story_progress_edit" : "story_progress_set")}
          </Button>
        )}
      </header>

      <div className="game-story-progress__body" aria-busy={loading || saving}>
        {loading && <p role="status">{t("story_progress_loading")}</p>}
        {loadError && (
          <div className="game-story-progress__actions">
            <p role="alert">{t("story_progress_load_error")}</p>
            <Button theme="outline" onClick={retryLoad}>
              {t("story_progress_retry")}
            </Button>
          </div>
        )}
        {!loading && !loadError && (
          <div className="game-story-progress__snapshot">
            {(automatic || lastSaveAt !== null) && (
              <div className="game-story-progress__meter-heading">
                <h3>{t("story_progress_from_save")}</h3>
                {lastSaveAt !== null && (
                  <time dateTime={new Date(lastSaveAt).toISOString()}>
                    {formatDateTime(lastSaveAt)}
                  </time>
                )}
              </div>
            )}
            {automatic ? (
              <>
                {automatic.percent === null ? (
                  <p className="game-story-progress__empty">
                    {t("story_progress_percent_missing")}
                  </p>
                ) : (
                  <StoryMeter
                    percent={automatic.percent}
                    label={t(
                      automatic.progressKind === "story"
                        ? "story_progress_story_completion"
                        : "story_progress_total_completion"
                    )}
                  />
                )}
                {(automatic.saveTitle ||
                  automatic.trackedQuestId ||
                  automatic.missionDescription) && (
                  <div className="game-story-progress__mission">
                    {(automatic.saveTitle || automatic.trackedQuestId) && (
                      <>
                        <h3>
                          {t(
                            automatic.trackedQuestId
                              ? "story_progress_quest_id"
                              : automatic.progressKind === "story"
                                ? "story_progress_tracked_quest"
                                : automatic.percent === null
                                  ? "story_progress_tracked_quest"
                                  : "story_progress_save_title"
                          )}
                        </h3>
                        <strong>
                          {automatic.saveTitle || automatic.trackedQuestId}
                        </strong>
                      </>
                    )}
                    {automatic.summaryKey && <p>{t(automatic.summaryKey)}</p>}
                    {automatic.missionDescription && (
                      <p>{automatic.missionDescription}</p>
                    )}
                  </div>
                )}
              </>
            ) : null}
            {automaticStatus !== "ready" && (
              <p className="game-story-progress__empty" role="status">
                {t(`story_progress_status_${automaticStatus}`)}
              </p>
            )}
            <details className="game-story-progress__options">
              <summary>{t("story_progress_save_options")}</summary>
              <div className="game-story-progress__actions">
                <Button
                  theme="outline"
                  size="small"
                  disabled={selectingFolder}
                  onClick={retryLoad}
                >
                  {t("story_progress_rescan")}
                </Button>
                {canSelectSaveFolder && (
                  <Button
                    theme="outline"
                    size="small"
                    disabled={selectingFolder}
                    onClick={() => void chooseSaveFolder()}
                  >
                    {t("story_progress_select_folder")}
                  </Button>
                )}
                {hasCustomSaveFolder && (
                  <Button
                    theme="outline"
                    size="small"
                    disabled={selectingFolder}
                    onClick={() => void chooseSaveFolder(true)}
                  >
                    {t("story_progress_default_folders")}
                  </Button>
                )}
              </div>
            </details>
            {folderError && (
              <p role="alert">{t("story_progress_folder_error")}</p>
            )}
          </div>
        )}
        {!editing && progress && (
          <div className="game-story-progress__snapshot">
            <h3>{t("story_progress_manual_entry")}</h3>
            {progress.percent !== null && (
              <StoryMeter
                percent={progress.percent}
                label={t("story_progress_completed")}
              />
            )}
            {(progress.missionName || progress.missionDescription) && (
              <div className="game-story-progress__mission">
                <h3>{t("story_progress_current_mission")}</h3>
                {progress.missionName && (
                  <strong>{progress.missionName}</strong>
                )}
                {progress.missionDescription && (
                  <p>{progress.missionDescription}</p>
                )}
              </div>
            )}
          </div>
        )}
        {editing && (
          <form className="game-story-progress__form" onSubmit={saveProgress}>
            <div className="game-story-progress__fields">
              <TextField
                name="percent"
                type="number"
                min={0}
                max={100}
                step="any"
                label={t("story_progress_percent")}
                defaultValue={progress?.percent ?? ""}
                disabled={saving}
              />
              <TextField
                name="missionName"
                label={t("story_progress_mission_name")}
                defaultValue={progress?.missionName}
                maxLength={STORY_MISSION_NAME_LIMIT}
                disabled={saving}
              />
            </div>
            <div className="game-story-progress__description">
              <label htmlFor={descriptionId}>
                {t("story_progress_description")}
              </label>
              <textarea
                id={descriptionId}
                name="missionDescription"
                defaultValue={progress?.missionDescription}
                maxLength={STORY_MISSION_DESCRIPTION_LIMIT}
                rows={3}
                disabled={saving}
              />
            </div>
            {saveError && <p role="alert">{t("story_progress_save_error")}</p>}
            <div className="game-story-progress__actions">
              <Button type="submit" disabled={saving}>
                {t(saving ? "story_progress_saving" : "story_progress_save")}
              </Button>
              <Button
                theme="outline"
                disabled={saving}
                onClick={() => setEditing(false)}
              >
                {t("story_progress_cancel")}
              </Button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
