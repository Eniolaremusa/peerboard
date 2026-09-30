"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { prompts } from "@/config/prompts";
import { sessionConfig, sessionDurationMs } from "@/config/session";
import SessionRoom, {
  type CandidateStage,
  type InterviewerNote,
  type RailTab,
  type Role,
} from "@/components/SessionRoom";
import SessionReport, {
  evaluationLine,
  type Evaluation,
  type TranscriptLine,
} from "@/components/SessionReport";
import "@excalidraw/excalidraw/index.css";

const Excalidraw = dynamic(
  async () => (await import("@excalidraw/excalidraw")).Excalidraw,
  { ssr: false },
);

type SessionStatus = "idle" | "active" | "evaluating" | "report";

type Turn = {
  question: string;
  answer: string;
};

type BoardApi = {
  getSceneElements: () => readonly unknown[];
  getAppState: () => Record<string, unknown>;
  getFiles: () => Record<string, unknown> | null;
};

type MicStatus = "off" | "listening" | "blocked";

type RecordingPart = {
  mimeType: string;
  data: string;
};

type EvaluateBody = {
  promptId: string;
  revealedFactIds: string[];
  turns: Turn[];
  transcript: TranscriptLine[];
  interviewerNotes: InterviewerNote[];
  talkMs: number;
  boardMs: number;
  elapsedMs: number;
  snapshotCount: number;
  lastSnapshot?: { mimeType: string; data: string };
  recording?: RecordingPart;
};

type SpeechAlternative = {
  transcript: string;
  confidence?: number;
};

type SpeechResult = {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechAlternative | undefined;
};

type BrowserSpeech = {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  onresult: ((event: { resultIndex: number; results: SpeechResult[] }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type StopMic = () => Promise<RecordingPart | undefined>;

function speechRecognitionCtor() {
  const win = window as unknown as {
    SpeechRecognition?: new () => BrowserSpeech;
    webkitSpeechRecognition?: new () => BrowserSpeech;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition;
}

function pickAudioMime() {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function bestTranscript(result: SpeechResult) {
  let best = result[0];
  if (!best) {
    return "";
  }
  for (let i = 1; i < result.length; i += 1) {
    const alt = result[i];
    if (!alt?.transcript.trim()) {
      continue;
    }
    const bestConf = best.confidence ?? 0;
    const altConf = alt.confidence ?? 0;
    if (
      altConf > bestConf ||
      (altConf === bestConf && alt.transcript.trim().length > best.transcript.trim().length)
    ) {
      best = alt;
    }
  }
  return best.transcript.replace(/\s+/g, " ").trim();
}

const stitchAfterMs = 2500;
const continuation =
  /^(and|or|but|so|because|then|also|with|of|the|a|an|to|that|which|who|how|what|for|in|on|at|are|is|was|were|not|they|we|i)\b/i;

function commitTranscript(
  lines: TranscriptLine[],
  startedAt: number,
  lastCommitAt: { current: number },
  text: string,
) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return;
  }
  const atMs = Date.now() - startedAt;
  const last = lines.at(-1);
  const gap = atMs - lastCommitAt.current;
  const shouldStitch =
    Boolean(last) &&
    lastCommitAt.current > 0 &&
    (gap < stitchAfterMs || (gap < 4000 && continuation.test(cleaned)));
  if (last && shouldStitch) {
    last.text = `${last.text} ${cleaned}`.replace(/\s+/g, " ");
  } else {
    lines.push({ atMs, text: cleaned });
  }
  lastCommitAt.current = atMs;
}

function rmsFromTimeDomain(samples: Uint8Array) {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const n = (samples[i]! - 128) / 128;
    sum += n * n;
  }
  return Math.sqrt(sum / samples.length);
}

function formatCountdown(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

type TranscribeResponse = {
  text?: string;
  segments?: TranscriptLine[];
  mode?: "groq" | "stub";
  error?: string;
  status?: number;
};

async function transcribeBlob(blob: Blob, offsetMs: number) {
  const form = new FormData();
  form.append("file", blob, blob.type.includes("mp4") ? "audio.mp4" : "audio.webm");
  form.append("offsetMs", String(offsetMs));
  form.append("capture", "getUserMedia");
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

function failureCode(err: unknown) {
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as { status?: unknown }).status;
    if (typeof status === "number" && status > 0) {
      return String(status);
    }
  }
  if (err instanceof Error && /^\d{3}$/.test(err.message)) {
    return err.message;
  }
  return "error";
}

function transcriptionLine(opts: {
  groqOk: boolean;
  chromeUsed: boolean;
  groqError?: string;
}) {
  if (opts.groqOk) {
    return "Transcription: Whisper via Groq";
  }
  if (opts.chromeUsed && opts.groqError) {
    return `Transcription: Chrome speech fallback (Groq failed: ${opts.groqError})`;
  }
  if (opts.chromeUsed) {
    return "Transcription: Chrome speech fallback";
  }
  if (opts.groqError) {
    return `Transcription: Whisper via Groq failed: ${opts.groqError}`;
  }
  return "Transcription: none";
}

function recordingToBlob(recording: RecordingPart) {
  const binary = atob(recording.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: recording.mimeType || "audio/webm" });
}

function Countdown({
  endsAt,
  running,
  onExpire,
}: {
  endsAt: string | null;
  running: boolean;
  onExpire: () => void;
}) {
  const [remainingMs, setRemainingMs] = useState(sessionDurationMs);

  useEffect(() => {
    if (!running || !endsAt) {
      setRemainingMs(sessionDurationMs);
      return;
    }

    const tick = () => {
      const remaining = Date.parse(endsAt) - Date.now();
      if (remaining <= 0) {
        setRemainingMs(0);
        onExpire();
        return;
      }
      setRemainingMs(remaining);
    };

    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [running, endsAt, onExpire]);

  const label = formatCountdown(remainingMs);

  return (
    <time
      dateTime={`PT${Math.floor(remainingMs / 1000)}S`}
      className="shrink-0 tabular-nums text-sm font-medium tracking-tight text-neutral-900"
    >
      {label}
    </time>
  );
}

function PromptPicker({
  selectedId,
  onSelect,
  onPracticeSolo,
  onCreateRoom,
  creatingRole,
  roomError,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPracticeSolo: () => void;
  onCreateRoom: (role: Role) => void;
  creatingRole: Role | null;
  roomError: string | null;
}) {
  return (
    <div className="flex h-full justify-center overflow-y-auto px-8 py-10">
      <div className="w-full max-w-2xl">
        <h1 className="text-xl font-medium tracking-tight text-neutral-900">
          Choose a prompt
        </h1>
        <ul className="mt-8 space-y-3">
          {prompts.map((prompt) => {
            const selected = prompt.id === selectedId;
            return (
              <li key={prompt.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelect(prompt.id)}
                  className={`w-full rounded-lg border px-4 py-3.5 text-left transition-[border-color,transform] duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96] ${
                    selected
                      ? "border-neutral-900 bg-white"
                      : "border-neutral-200 bg-white"
                  }`}
                >
                  <p className="text-sm font-medium text-neutral-900">
                    {prompt.title}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-neutral-600">
                    {prompt.brief}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-10">
          <h2 className="text-sm font-medium text-neutral-900">Practice solo</h2>
          <p className="mt-1 text-sm leading-6 text-neutral-500">
            The model holds the brief and answers your questions.
          </p>
          <button
            type="button"
            onClick={onPracticeSolo}
            disabled={!selectedId || creatingRole !== null}
            className="mt-3 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition-transform duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Start solo session
          </button>
        </div>
        <div className="mt-8">
          <h2 className="text-sm font-medium text-neutral-900">
            Practice with a peer
          </h2>
          <p className="mt-1 text-sm leading-6 text-neutral-500">
            Create a room and send the link. You pick a seat; they get the
            other. If you already have a link, open it.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onCreateRoom("interviewer")}
              disabled={!selectedId || creatingRole !== null}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 transition-transform duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creatingRole === "interviewer"
                ? "Creating…"
                : "Create as interviewer"}
            </button>
            <button
              type="button"
              onClick={() => onCreateRoom("candidate")}
              disabled={!selectedId || creatingRole !== null}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 transition-transform duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creatingRole === "candidate"
                ? "Creating…"
                : "Create as candidate"}
            </button>
          </div>
          {roomError ? (
            <p className="mt-3 text-sm text-red-700">{roomError}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ClarifyingQuestions({
  promptId,
  revealedFactIds,
  onTurn,
}: {
  promptId: string;
  revealedFactIds: string[];
  onTurn: (turn: Turn, revealedFactIds: string[]) => void;
}) {
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextQuestion = question.trim();
    if (!nextQuestion || pending) {
      return;
    }

    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/clarify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          promptId,
          question: nextQuestion,
          revealedFactIds,
        }),
      });
      let payload: {
        answer?: string;
        revealedFactIds?: string[];
        error?: string;
      } = {};
      try {
        payload = (await response.json()) as typeof payload;
      } catch {
        setError(`Could not get an answer${response.status ? ` (${response.status})` : ""}`);
        return;
      }
      if (!payload.answer) {
        setError(payload.error ?? "Could not get an answer");
        return;
      }

      const nextIds = new Set(revealedFactIds);
      for (const id of payload.revealedFactIds ?? []) {
        nextIds.add(id);
      }
      onTurn({ question: nextQuestion, answer: payload.answer }, [...nextIds]);
      setQuestion("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not get an answer");
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="flex shrink-0 flex-col border-t border-neutral-200 bg-white"
    >
      {error ? (
        <p className="px-5 pt-2.5 text-sm leading-6 text-red-700">{error}</p>
      ) : null}
      <div className="flex items-center gap-3 px-5 py-2.5">
      <input
        type="text"
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        disabled={pending}
        placeholder="Ask a clarifying question"
        className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus-visible:border-neutral-500"
      />
      <button
        type="submit"
        disabled={pending || question.trim() === ""}
        className="shrink-0 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition-transform duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Asking…" : "Ask"}
      </button>
      </div>
    </form>
  );
}

export default function WhiteboardSession() {
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [promptId, setPromptId] = useState<string | null>(null);
  const [endsAt, setEndsAt] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [revealedFactIds, setRevealedFactIds] = useState<string[]>([]);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const finishingRef = useRef(false);
  const apiRef = useRef<BoardApi | null>(null);
  const startedAtRef = useRef(0);
  const transcriptRef = useRef<TranscriptLine[]>([]);
  const snapshotsRef = useRef<{ atMs: number; dataUrl: string }[]>([]);
  const talkMsRef = useRef(0);
  const boardMsRef = useRef(0);
  const speakingRef = useRef(false);
  const lastDrawRef = useRef(0);
  const listeningRef = useRef(false);
  const stopMicRef = useRef<StopMic>(async () => undefined);
  const pendingStreamRef = useRef<MediaStream | null>(null);
  const groqAvailableRef = useRef(false);
  const groqOkRef = useRef(false);
  const chromeUsedRef = useRef(false);
  const groqErrorRef = useRef<string | undefined>(undefined);
  const liveTranscribeRef = useRef(Promise.resolve());
  const [micStatus, setMicStatus] = useState<MicStatus>("off");
  const [heard, setHeard] = useState<TranscriptLine[]>([]);
  const [serviceLine, setServiceLine] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [canRetry, setCanRetry] = useState(false);
  const evaluatePayloadRef = useRef<EvaluateBody | null>(null);
  const retryingRef = useRef(false);
  const [role, setRole] = useState<Role>("candidate");
  const [stage, setStage] = useState<CandidateStage>("board");
  const [notes, setNotes] = useState("");
  const [interviewerNotes, setInterviewerNotes] = useState<InterviewerNote[]>(
    [],
  );
  const [railTab, setRailTab] = useState<RailTab>("prompt");
  const [creatingRole, setCreatingRole] = useState<Role | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);

  const resetSession = useCallback(() => {
    finishingRef.current = false;
    setStatus("idle");
    setEndsAt(null);
    setPromptOpen(false);
    setTurns([]);
    setRevealedFactIds([]);
    setEvaluation(null);
    setReportError(null);
    setMicStatus("off");
    setHeard([]);
    setServiceLine(null);
    setRetrying(false);
    setCanRetry(false);
    evaluatePayloadRef.current = null;
    retryingRef.current = false;
    setRole("candidate");
    setStage("board");
    setNotes("");
    setInterviewerNotes([]);
    setRailTab("prompt");
    setCreatingRole(null);
    setRoomError(null);
  }, []);

  const captureBoard = useCallback(async () => {
    const api = apiRef.current;
    if (!api || !startedAtRef.current) {
      return;
    }
    try {
      const { exportToBlob } = await import("@excalidraw/excalidraw");
      const blob = await exportToBlob({
        elements: api.getSceneElements() as never,
        appState: {
          ...api.getAppState(),
          exportBackground: true,
          exportWithDarkMode: false,
        } as never,
        files: api.getFiles() as never,
        mimeType: "image/jpeg",
        quality: 0.45,
        maxWidthOrHeight: 800,
      });
      const dataUrl = await blobToDataUrl(blob);
      snapshotsRef.current.push({
        atMs: Date.now() - startedAtRef.current,
        dataUrl,
      });
    } catch {
      // Snapshot is best-effort; the report still runs without it.
    }
  }, []);

  const requestEvaluation = useCallback(async (body: EvaluateBody) => {
    const response = await fetch("/api/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as Evaluation & {
      error?: string;
      services?: { evaluation?: { ran?: string; error?: string } };
    };
    const evalNote = evaluationLine(
      payload.services?.evaluation?.ran,
      payload.services?.evaluation?.error,
    );
    setServiceLine(
      `${transcriptionLine({
        groqOk: groqOkRef.current,
        chromeUsed: chromeUsedRef.current,
        groqError: groqErrorRef.current,
      })} · ${evalNote}`,
    );
    if (payload.summary) {
      setEvaluation(payload);
      setReportError(null);
      return;
    }
    throw new Error(payload.error ?? "Could not write the report");
  }, []);

  const retryEvaluation = useCallback(async () => {
    const body = evaluatePayloadRef.current;
    if (!body || retryingRef.current) {
      return;
    }
    retryingRef.current = true;
    setRetrying(true);
    setReportError(null);
    try {
      await requestEvaluation(body);
    } catch (err) {
      setReportError(
        err instanceof Error ? err.message : "Could not write the report",
      );
    } finally {
      retryingRef.current = false;
      setRetrying(false);
    }
  }, [requestEvaluation]);

  const finishSession = useCallback(async () => {
    if (finishingRef.current) {
      return;
    }
    if (!promptId) {
      return;
    }
    finishingRef.current = true;
    listeningRef.current = false;
    const recording = await stopMicRef.current();
    await liveTranscribeRef.current;
    if (groqAvailableRef.current && recording?.data) {
      try {
        const finalPass = await transcribeBlob(recordingToBlob(recording), 0);
        if (finalPass.mode === "groq") {
          groqOkRef.current = true;
          const lines = finalPass.segments?.filter((line) => line.text) ?? [];
          transcriptRef.current =
            lines.length > 0
              ? lines
              : finalPass.text
                ? [{ atMs: 0, text: finalPass.text }]
                : transcriptRef.current;
        }
      } catch (err) {
        groqErrorRef.current = failureCode(err);
      }
    }
    const heardLines = [...transcriptRef.current];
    setHeard(heardLines);
    setStatus("evaluating");
    setEndsAt(null);
    setPromptOpen(false);
    setMicStatus("off");
    await captureBoard();

    const last = snapshotsRef.current.at(-1);
    const lastSnapshot = last
      ? {
          mimeType: "image/jpeg",
          data: last.dataUrl.split(",")[1] ?? "",
        }
      : undefined;
    const spokenChars = transcriptRef.current.reduce(
      (count, line) => count + line.text.length,
      0,
    );

    const evaluateBody: EvaluateBody = {
      promptId,
      revealedFactIds,
      turns,
      transcript: transcriptRef.current,
      interviewerNotes,
      talkMs: talkMsRef.current,
      boardMs: boardMsRef.current,
      elapsedMs: startedAtRef.current ? Date.now() - startedAtRef.current : 0,
      snapshotCount: snapshotsRef.current.length,
      lastSnapshot,
      recording:
        groqAvailableRef.current || spokenChars >= 80
          ? undefined
          : recording,
    };
    evaluatePayloadRef.current = evaluateBody;
    setCanRetry(true);

    try {
      await requestEvaluation(evaluateBody);
    } catch (err) {
      setServiceLine(
        (current) =>
          current ??
          `${transcriptionLine({
            groqOk: groqOkRef.current,
            chromeUsed: chromeUsedRef.current,
            groqError: groqErrorRef.current,
          })} · Evaluation: unknown`,
      );
      setReportError(
        err instanceof Error ? err.message : "Could not write the report",
      );
    } finally {
      setStatus("report");
    }
  }, [
    captureBoard,
    interviewerNotes,
    promptId,
    revealedFactIds,
    requestEvaluation,
    turns,
  ]);

  const startSession = async () => {
    if (status !== "idle" || !promptId) {
      return;
    }
    finishingRef.current = false;
    setTurns([]);
    setRevealedFactIds([]);
    setEvaluation(null);
    setReportError(null);
    setHeard([]);
    setServiceLine(null);
    setRetrying(false);
    setCanRetry(false);
    evaluatePayloadRef.current = null;
    retryingRef.current = false;
    setMicStatus("off");
    groqOkRef.current = false;
    chromeUsedRef.current = false;
    groqErrorRef.current = undefined;
    pendingStreamRef.current?.getTracks().forEach((track) => track.stop());
    pendingStreamRef.current = null;
    try {
      pendingStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      pendingStreamRef.current = null;
    }
    setEndsAt(new Date(Date.now() + sessionDurationMs).toISOString());
    setStatus("active");
    setPromptOpen(false);
    setRole("candidate");
    setStage("board");
    setNotes("");
    setInterviewerNotes([]);
    setRailTab("prompt");
  };

  const createRoom = async (role: Role) => {
    if (status !== "idle" || !promptId || creatingRole) {
      return;
    }
    setCreatingRole(role);
    setRoomError(null);
    try {
      const response = await fetch("/api/livekit/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create", promptId, role }),
      });
      const payload = (await response.json()) as {
        roomId?: string;
        role?: Role;
        error?: string;
      };
      if (!payload.roomId || !payload.role) {
        throw new Error(payload.error ?? "Could not create a room");
      }
      window.location.assign(`/room/${payload.roomId}?role=${payload.role}`);
    } catch (err) {
      setRoomError(
        err instanceof Error ? err.message : "Could not create a room",
      );
      setCreatingRole(null);
    }
  };

  useEffect(() => {
    if (status !== "active") {
      return;
    }

    startedAtRef.current = Date.now();
    transcriptRef.current = [];
    snapshotsRef.current = [];
    talkMsRef.current = 0;
    boardMsRef.current = 0;
    speakingRef.current = false;
    lastDrawRef.current = 0;
    listeningRef.current = true;
    groqOkRef.current = false;
    chromeUsedRef.current = false;
    groqErrorRef.current = undefined;
    console.log("[transcribe] capture=getUserMedia");

    let stopped = false;
    let settled = false;
    let stream: MediaStream | null = null;
    let recordStream: MediaStream | null = null;
    let liveStream: MediaStream | null = null;
    let recorder: MediaRecorder | null = null;
    let sliceRecorder: MediaRecorder | null = null;
    let speech: BrowserSpeech | null = null;
    let audioContext: AudioContext | null = null;
    let levelTimer = 0;
    let speechRestartTimer = 0;
    let sliceTimer = 0;
    let lastInterim = "";
    const lastCommitAt = { current: 0 };
    const chunks: Blob[] = [];
    let resolveRecording: (value: RecordingPart | undefined) => void = () => {};
    const recordingDone = new Promise<RecordingPart | undefined>((resolve) => {
      resolveRecording = resolve;
    });

    const settleRecording = (value: RecordingPart | undefined) => {
      if (settled) {
        return;
      }
      settled = true;
      resolveRecording(value);
    };

    const flushInterim = () => {
      const text = lastInterim.trim();
      lastInterim = "";
      if (text) {
        commitTranscript(
          transcriptRef.current,
          startedAtRef.current,
          lastCommitAt,
          text,
        );
      }
    };

    const stopMic: StopMic = async () => {
      if (stopped) {
        return recordingDone;
      }
      stopped = true;
      listeningRef.current = false;
      speakingRef.current = false;
      if (speechRestartTimer) {
        window.clearTimeout(speechRestartTimer);
      }
      if (sliceTimer) {
        window.clearTimeout(sliceTimer);
      }
      flushInterim();
      try {
        speech?.stop();
      } catch {
        // already stopped
      }
      if (levelTimer) {
        window.clearInterval(levelTimer);
      }
      if (sliceRecorder && sliceRecorder.state !== "inactive") {
        sliceRecorder.stop();
      }
      if (recorder && recorder.state !== "inactive") {
        window.setTimeout(() => {
          if (!settled && chunks.length) {
            const blob = new Blob(chunks, {
              type: recorder?.mimeType || "audio/webm",
            });
            void blobToDataUrl(blob).then((dataUrl) => {
              settleRecording({
                mimeType: blob.type || "audio/webm",
                data: dataUrl.split(",")[1] ?? "",
              });
            });
            return;
          }
          settleRecording(undefined);
        }, 2500);
        recorder.stop();
      } else {
        settleRecording(undefined);
      }
      stream?.getTracks().forEach((track) => track.stop());
      recordStream?.getTracks().forEach((track) => track.stop());
      liveStream?.getTracks().forEach((track) => track.stop());
      if (audioContext && audioContext.state !== "closed") {
        void audioContext.close();
      }
      return recordingDone;
    };
    stopMicRef.current = stopMic;

    const tick = window.setInterval(() => {
      const step = 250;
      if (speakingRef.current) {
        talkMsRef.current += step;
      }
      if (Date.now() - lastDrawRef.current < 2000) {
        boardMsRef.current += step;
      }
    }, 250);

    const firstSnap = window.setTimeout(() => {
      void captureBoard();
    }, 1500);
    const snapTimer = window.setInterval(() => {
      void captureBoard();
    }, sessionConfig.snapshotIntervalMs);

    const startSpeech = () => {
      const SpeechCtor = speechRecognitionCtor();
      if (!SpeechCtor || !listeningRef.current || stopped) {
        return;
      }

      const rec = new SpeechCtor();
      speech = rec;
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 3;
      rec.lang = navigator.language || "en-US";
      rec.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          if (!result) {
            continue;
          }
          const text = bestTranscript(result);
          if (!text) {
            continue;
          }
          if (result.isFinal) {
            lastInterim = "";
            commitTranscript(
              transcriptRef.current,
              startedAtRef.current,
              lastCommitAt,
              text,
            );
          } else {
            lastInterim = text;
          }
        }
      };
      rec.onerror = (event) => {
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          listeningRef.current = false;
          setMicStatus("blocked");
        }
      };
      rec.onend = () => {
        if (!listeningRef.current || stopped) {
          return;
        }
        speechRestartTimer = window.setTimeout(() => {
          startSpeech();
        }, 150);
      };
      try {
        rec.start();
        chromeUsedRef.current = true;
      } catch {
        speechRestartTimer = window.setTimeout(() => {
          startSpeech();
        }, 400);
      }
    };

    const groqReady = fetch("/api/transcribe?capture=getUserMedia", {
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = (await response.json()) as { available?: boolean };
        groqAvailableRef.current = Boolean(payload.available);
        return groqAvailableRef.current;
      })
      .catch(() => {
        groqAvailableRef.current = false;
        return false;
      });

    void (async () => {
      try {
        stream = pendingStreamRef.current;
        pendingStreamRef.current = null;
        if (!stream || stream.getTracks().every((track) => track.readyState !== "live")) {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
          });
        }
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const AudioCtx =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        audioContext = new AudioCtx();
        await audioContext.resume();
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        const samples = new Uint8Array(new ArrayBuffer(analyser.fftSize));
        let lastVoiceAt = 0;
        levelTimer = window.setInterval(() => {
          analyser.getByteTimeDomainData(samples);
          if (rmsFromTimeDomain(samples) > 0.012) {
            lastVoiceAt = Date.now();
          }
          speakingRef.current = Date.now() - lastVoiceAt < 700;
        }, 100);

        const mime = pickAudioMime();
        recordStream = stream.clone();
        recorder = mime
          ? new MediaRecorder(recordStream, {
              mimeType: mime,
              audioBitsPerSecond: 24_000,
            })
          : new MediaRecorder(recordStream);
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunks.push(event.data);
          }
        };
        recorder.onstop = () => {
          void finalizeChunks();
        };
        const finalizeChunks = async () => {
          if (settled) {
            return;
          }
          if (!chunks.length) {
            settleRecording(undefined);
            return;
          }
          const blob = new Blob(chunks, {
            type: recorder?.mimeType || mime || "audio/webm",
          });
          if (blob.size > 20_000_000) {
            settleRecording(undefined);
            return;
          }
          const dataUrl = await blobToDataUrl(blob);
          settleRecording({
            mimeType: blob.type || "audio/webm",
            data: dataUrl.split(",")[1] ?? "",
          });
        };
        try {
          recorder.start(2000);
        } catch {
          recorder.start();
        }

        const useGroq = await groqReady;
        if (stopped) {
          return;
        }
        if (useGroq) {
          liveStream = stream.clone();
          const startSlice = () => {
            if (stopped || !liveStream) {
              return;
            }
            const sliceMime = pickAudioMime();
            const rec = sliceMime
              ? new MediaRecorder(liveStream, {
                  mimeType: sliceMime,
                  audioBitsPerSecond: 24_000,
                })
              : new MediaRecorder(liveStream);
            sliceRecorder = rec;
            const sliceChunks: Blob[] = [];
            const offsetMs = Date.now() - startedAtRef.current;
            rec.ondataavailable = (event) => {
              if (event.data.size > 0) {
                sliceChunks.push(event.data);
              }
            };
            rec.onstop = () => {
              const blob = new Blob(sliceChunks, {
                type: rec.mimeType || sliceMime || "audio/webm",
              });
              if (blob.size > 800) {
                liveTranscribeRef.current = liveTranscribeRef.current
                  .then(async () => {
                    const result = await transcribeBlob(blob, offsetMs);
                    if (result.mode === "groq") {
                      groqOkRef.current = true;
                    }
                    if (result.mode !== "groq" || stopped) {
                      return;
                    }
                    for (const line of result.segments ?? []) {
                      if (line.text) {
                        transcriptRef.current.push(line);
                      }
                    }
                  })
                  .catch((err) => {
                    groqErrorRef.current = failureCode(err);
                  });
              }
              if (!stopped && listeningRef.current) {
                startSlice();
              }
            };
            rec.start();
            sliceTimer = window.setTimeout(() => {
              if (rec.state !== "inactive") {
                rec.stop();
              }
            }, sessionConfig.liveSliceMs);
          };
          startSlice();
        } else {
          startSpeech();
        }

        setMicStatus("listening");
      } catch {
        if (!stopped) {
          setMicStatus("blocked");
          settleRecording(undefined);
        }
      }
    })();

    return () => {
      window.clearInterval(tick);
      window.clearTimeout(firstSnap);
      window.clearInterval(snapTimer);
      void stopMic();
    };
  }, [captureBoard, status]);

  const running = status === "active";
  const selectedPrompt = prompts.find((item) => item.id === promptId);

  return (
    <div className="flex h-dvh flex-col bg-neutral-50">
      <main className="flex min-h-0 flex-1 flex-col">
        {running && promptId && selectedPrompt ? (
          <SessionRoom
            role={role}
            onRoleChange={setRole}
            showRoleToggle={process.env.NODE_ENV === "development"}
            stage={stage}
            onToggleBoard={() =>
              setStage((current) => (current === "board" ? "video" : "board"))
            }
            onOpenNotes={() => setStage("notes")}
            notes={notes}
            onNotesChange={setNotes}
            railTab={railTab}
            onRailTab={setRailTab}
            prompt={selectedPrompt}
            revealedFactIds={revealedFactIds}
            promptOpen={promptOpen}
            onTogglePrompt={() => setPromptOpen((open) => !open)}
            micStatus={micStatus}
            timer={
              <Countdown
                endsAt={endsAt}
                running={running}
                onExpire={finishSession}
              />
            }
            onEnd={finishSession}
            board={
              <Excalidraw
                aiEnabled={false}
                excalidrawAPI={(api) => {
                  apiRef.current = api as unknown as BoardApi;
                }}
                onChange={() => {
                  lastDrawRef.current = Date.now();
                }}
                initialData={{ appState: { viewBackgroundColor: "#FFFFFF" } }}
              />
            }
            interviewerNotes={interviewerNotes}
            onAddInterviewerNote={(text) => {
              setInterviewerNotes((current) => [
                ...current,
                {
                  atMs: startedAtRef.current
                    ? Date.now() - startedAtRef.current
                    : 0,
                  text,
                },
              ]);
            }}
            ask={
              <>
                {turns.length > 0 ? (
                  <div className="max-h-32 shrink-0 overflow-y-auto border-t border-neutral-200 bg-white px-5 py-3">
                    {turns.map((turn, index) => (
                      <div key={index} className="not-last:mb-3">
                        <p className="text-sm text-neutral-500">{turn.question}</p>
                        <p className="mt-1 text-sm leading-6 text-neutral-800">
                          {turn.answer}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}
                <ClarifyingQuestions
                  promptId={promptId}
                  revealedFactIds={revealedFactIds}
                  onTurn={(turn, nextIds) => {
                    setTurns((current) => [...current, turn]);
                    setRevealedFactIds(nextIds);
                  }}
                />
              </>
            }
          />
        ) : status === "evaluating" ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-neutral-500">Writing the session report…</p>
          </div>
        ) : status === "report" ? (
          <SessionReport
            evaluation={evaluation}
            error={reportError}
            transcript={heard}
            interviewerNotes={interviewerNotes}
            serviceLine={serviceLine}
            retrying={retrying}
            onRetry={canRetry ? retryEvaluation : null}
            onRestart={resetSession}
          />
        ) : (
          <PromptPicker
            selectedId={promptId}
            onSelect={setPromptId}
            onPracticeSolo={startSession}
            onCreateRoom={createRoom}
            creatingRole={creatingRole}
            roomError={roomError}
          />
        )}
      </main>
    </div>
  );
}
