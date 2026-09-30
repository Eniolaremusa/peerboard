import { sessionConfig } from "@/config/session";

export type SliceSegment = {
  atMs: number;
  text: string;
};

type TranscribeResponse = {
  text?: string;
  segments?: SliceSegment[];
  mode?: "groq" | "stub";
  error?: string;
  status?: number;
};

export function pickAudioMime() {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export async function transcribeBlob(
  blob: Blob,
  offsetMs: number,
  opts: { capture: string; speaker?: string },
) {
  const form = new FormData();
  form.append("file", blob, blob.type.includes("mp4") ? "audio.mp4" : "audio.webm");
  form.append("offsetMs", String(offsetMs));
  form.append("capture", opts.capture);
  if (opts.speaker) {
    form.append("speaker", opts.speaker);
  }
  const response = await fetch("/api/transcribe", { method: "POST", body: form });
  const payload = (await response.json()) as TranscribeResponse;
  if (!response.ok) {
    const status = payload.status ?? response.status;
    const error = new Error(String(status)) as Error & { status: number };
    error.status = status;
    throw error;
  }
  return payload;
}

export function startWhisperSlicer(opts: {
  stream: MediaStream;
  startedAt: () => number;
  capture: string;
  speaker?: string;
  onSegments: (segments: SliceSegment[]) => void;
}) {
  let stopped = false;
  let sliceTimer = 0;
  let sliceRecorder: MediaRecorder | null = null;
  let queue = Promise.resolve();
  let settleStop: (() => void) | null = null;

  const startSlice = () => {
    if (stopped) {
      return;
    }
    const mime = pickAudioMime();
    const rec = mime
      ? new MediaRecorder(opts.stream, {
          mimeType: mime,
          audioBitsPerSecond: 24_000,
        })
      : new MediaRecorder(opts.stream);
    sliceRecorder = rec;
    const chunks: Blob[] = [];
    const offsetMs = Date.now() - opts.startedAt();
    rec.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };
    rec.onstop = () => {
      const blob = new Blob(chunks, {
        type: rec.mimeType || mime || "audio/webm",
      });
      if (blob.size > 800) {
        queue = queue
          .then(async () => {
            const result = await transcribeBlob(blob, offsetMs, {
              capture: opts.capture,
              speaker: opts.speaker,
            });
            if (stopped && !settleStop) {
              return;
            }
            if (result.mode !== "groq") {
              return;
            }
            const segments = (result.segments ?? []).filter((line) => line.text);
            if (segments.length) {
              opts.onSegments(segments);
            }
          })
          .catch(() => {
            // Keep slicing; the next slice can still land.
          });
      }
      if (!stopped) {
        startSlice();
        return;
      }
      void queue.then(() => {
        settleStop?.();
        settleStop = null;
      });
    };
    try {
      rec.start();
    } catch {
      if (stopped) {
        settleStop?.();
        settleStop = null;
      }
      return;
    }
    sliceTimer = window.setTimeout(() => {
      if (rec.state !== "inactive") {
        rec.stop();
      }
    }, sessionConfig.liveSliceMs);
  };

  startSlice();

  return {
    stop: () =>
      new Promise<void>((resolve) => {
        if (stopped) {
          void queue.then(() => resolve());
          return;
        }
        stopped = true;
        if (sliceTimer) {
          window.clearTimeout(sliceTimer);
        }
        if (sliceRecorder && sliceRecorder.state !== "inactive") {
          settleStop = resolve;
          sliceRecorder.stop();
          return;
        }
        void queue.then(() => resolve());
      }),
  };
}
