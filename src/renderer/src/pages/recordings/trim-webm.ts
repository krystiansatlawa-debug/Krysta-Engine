type VideoCaptureElement = HTMLVideoElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};
const maxBytes = 96 * 1024 * 1024;
function waitFor(
  target: EventTarget,
  event: string,
  signal: AbortSignal,
  timeout = 10000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const clean = () => {
      clearTimeout(timer);
      target.removeEventListener(event, done);
      target.removeEventListener("error", fail);
      signal.removeEventListener("abort", cancel);
    };
    const done = () => {
      clean();
      resolve();
    };
    const fail = () => {
      clean();
      reject(Error("Video could not be loaded or decoded"));
    };
    const cancel = () => {
      clean();
      reject(Error("Trim cancelled"));
    };
    const timer = setTimeout(fail, timeout);
    target.addEventListener(event, done, { once: true });
    target.addEventListener("error", fail, { once: true });
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
  });
}
export async function trimWebm(
  url: string,
  start: number,
  end: number,
  audio: boolean,
  signal: AbortSignal,
  progress: (value: number) => void
) {
  if (
    !url.startsWith("blob:") ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end - start < 1 ||
    end - start > 94
  )
    throw Error("Invalid trim range");
  const video = document.createElement("video") as VideoCaptureElement;
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  let stream: MediaStream | null = null,
    recorder: MediaRecorder | null = null,
    interval: ReturnType<typeof setInterval> | undefined,
    deadline: ReturnType<typeof setTimeout> | undefined;
  let chunks: Blob[] = [],
    size = 0;
  try {
    const loaded = waitFor(video, "loadeddata", signal);
    video.src = url;
    await loaded;
    if (Number.isFinite(video.duration) && end > video.duration + 0.2)
      throw Error("Trim range exceeds clip duration");
    if (start > 0.05) {
      try {
        const seeked = waitFor(video, "seeked", signal, 4000);
        video.currentTime = start;
        await seeked;
        if (Math.abs(video.currentTime - start) > 0.25)
          throw Error("Clip cannot be seeked accurately");
      } catch (error) {
        if (signal.aborted) throw error;
        // Some MediaRecorder WebM files lack seek metadata. Decode forward instead.
        video.removeAttribute("src");
        video.load();
        const ready = waitFor(video, "loadeddata", signal);
        video.src = url;
        await ready;
        await new Promise<void>((resolve, reject) => {
          const clean = () => {
            clearInterval(tick);
            clearTimeout(deadline);
            signal.removeEventListener("abort", cancel);
            video.removeEventListener("ended", fail);
            video.pause();
          };
          const fail = () => {
            clean();
            reject(Error("Cannot reach trim start"));
          };
          const cancel = () => {
            clean();
            reject(Error("Trim cancelled"));
          };
          const tick = setInterval(() => {
            if (video.currentTime >= start) {
              clean();
              resolve();
            }
          }, 30);
          const deadline = setTimeout(fail, (start + 12) * 1000);
          signal.addEventListener("abort", cancel, { once: true });
          video.addEventListener("ended", fail, { once: true });
          if (signal.aborted) {
            cancel();
            return;
          }
          void video.play().catch(fail);
        });
      }
    }
    const capture = video.captureStream ?? video.mozCaptureStream;
    if (!capture) throw Error("Local video export unavailable");
    stream = capture.call(video);
    if (!stream.getVideoTracks().length)
      throw Error("Video capture track unavailable");
    if (audio && !stream.getAudioTracks().length)
      throw Error("Cannot preserve the original audio track");
    if (!audio)
      for (const track of stream.getAudioTracks()) stream.removeTrack(track);
    const mimeType = [
      "video/webm;codecs=vp8" + (audio ? ",opus" : ""),
      "video/webm;codecs=vp9" + (audio ? ",opus" : ""),
      "video/webm",
    ].find((m) => MediaRecorder.isTypeSupported(m));
    if (!mimeType) throw Error("WebM encoder unavailable");
    recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 5000000,
      audioBitsPerSecond: 128000,
    });
    const r = recorder;
    const duration = await new Promise<number>((resolve, reject) => {
      const actualStart = video.currentTime;
      let finished = false;
      let actualEnd = actualStart;
      const stop = () => {
        if (finished) return;
        finished = true;
        actualEnd = video.currentTime;
        video.pause();
        if (r.state !== "inactive") r.stop();
      };
      const cleanup = () => {
        if (interval) clearInterval(interval);
        if (deadline) clearTimeout(deadline);
        signal.removeEventListener("abort", cancel);
        video.removeEventListener("ended", stop);
      };
      const fail = (error: Error) => {
        cleanup();
        stop();
        reject(error);
      };
      const cancel = () => fail(Error("Trim cancelled"));
      r.ondataavailable = (e) => {
        if (!e.data.size) return;
        size += e.data.size;
        if (size > maxBytes) {
          chunks = [];
          fail(Error("Trim output exceeds size limit"));
          return;
        }
        chunks.push(e.data);
      };
      r.onerror = () => fail(Error("Video encoding failed"));
      r.onstop = () => {
        cleanup();
        resolve(actualEnd - actualStart);
      };
      signal.addEventListener("abort", cancel, { once: true });
      video.addEventListener("ended", stop, { once: true });
      if (signal.aborted) {
        cancel();
        return;
      }
      r.start(250);
      void video.play().catch(() => fail(Error("Video playback failed")));
      interval = setInterval(() => {
        progress(
          Math.min(
            1,
            Math.max(0, (video.currentTime - actualStart) / (end - start))
          )
        );
        if (video.currentTime >= end) stop();
      }, 40);
      deadline = setTimeout(
        () => fail(Error("Video export timed out")),
        Math.ceil((end - start + 15) * 1000)
      );
    });
    if (signal.aborted) throw Error("Trim cancelled");
    if (duration < 1 || Math.abs(duration - (end - start)) > 1.5)
      throw Error("Could not trim the requested range accurately");
    const blob = new Blob(chunks, { type: "video/webm" });
    if (!blob.size || blob.size > maxBytes) throw Error("Invalid export");
    return { bytes: new Uint8Array(await blob.arrayBuffer()), duration, audio };
  } finally {
    if (interval) clearInterval(interval);
    if (deadline) clearTimeout(deadline);
    if (recorder && recorder.state !== "inactive") recorder.stop();
    stream?.getTracks().forEach((t) => t.stop());
    video.pause();
    video.removeAttribute("src");
    video.load();
    chunks = [];
  }
}
