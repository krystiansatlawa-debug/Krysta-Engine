import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Scissors } from "lucide-react";
import { trimWebm } from "./trim-webm";
type Clip = { id: string; url: string; duration: number; audio: boolean };
export function RecordingTrimPanel({
  clip,
  onSaved,
}: {
  clip: Clip;
  onSaved: () => void;
}) {
  const { i18n } = useTranslation(),
    pl = i18n.language.startsWith("pl");
  const [start, setStart] = useState(0),
    [end, setEnd] = useState(Math.floor(clip.duration * 10) / 10),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const valid =
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    start >= 0 &&
    end - start >= 1 &&
    end <= clip.duration;
  const save = async () => {
    if (!valid || abort.current) return;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setSaved(false);
    setError("");
    setProgress(0);
    try {
      const result = await trimWebm(
        clip.url,
        start,
        end,
        clip.audio,
        controller.signal,
        setProgress
      );
      if (controller.signal.aborted) return;
      await window.electron.krystaRecordingTrimSave(
        clip.id,
        start,
        end,
        result.bytes,
        result.duration,
        result.audio
      );
      if (!controller.signal.aborted) {
        setSaved(true);
        onSaved();
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(String(e));
    } finally {
      if (abort.current === controller) {
        abort.current = null;
        setBusy(false);
      }
    }
  };
  return (
    <details className="krysta-recordings__trim">
      <summary>
        <Scissors size={15} /> {pl ? "Przytnij nagranie" : "Trim recording"}
      </summary>
      <div className="krysta-recordings__trim-fields">
        <label>
          {pl ? "Początek (s)" : "Start (s)"}
          <input
            type="number"
            min={0}
            max={clip.duration}
            step={0.1}
            value={start}
            disabled={busy}
            onChange={(e) => setStart(e.target.valueAsNumber)}
          />
        </label>
        <label>
          {pl ? "Koniec (s)" : "End (s)"}
          <input
            type="number"
            min={0}
            max={clip.duration}
            step={0.1}
            value={end}
            disabled={busy}
            onChange={(e) => setEnd(e.target.valueAsNumber)}
          />
        </label>
        <button disabled={!valid || busy} onClick={() => void save()}>
          {pl ? "Zapisz kopię" : "Save copy"}
        </button>
        {busy && (
          <button onClick={() => abort.current?.abort()}>
            {pl ? "Anuluj" : "Cancel"}
          </button>
        )}
      </div>
      <small>
        {pl
          ? "Oryginał pozostaje bez zmian. Eksport odbywa się lokalnie, w czasie zbliżonym do długości klipu."
          : "The original remains unchanged. Export runs locally and takes roughly the clip duration."}
      </small>
      {busy && <progress max={1} value={progress} />}
      {saved && (
        <p role="status">
          {pl ? "Zapisano przyciętą kopię." : "Trimmed copy saved."}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
