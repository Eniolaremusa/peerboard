"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { prompts } from "@/config/prompts";
import { formatClock, sessionConfig, sessionDurationMs } from "@/config/session";
import SessionRoom, {
  type CandidateStage,
  type InterviewerNote,
  type RailTab,
  type Role,
} from "@/components/SessionRoom";
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

type TranscriptLine = {
  atMs: number;
  text: string;
};

type Evaluation = {
  summary: string;
  framing: string;
  boardVsTalk: string;
  rewrittenMoment: { at: string; original: string; rewritten: string };
  canvasMatch: string;
  factsFound: string[];
  factsMissed: string[];
  coverage: {
    revealedCount: number;
    totalCount: number;
    criticalRevealedCount: number;
    criticalTotal: number;
    missedCritical: { fact: string }[];
  };
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

function evaluationLine(ran?: string, error?: string) {
  if (ran === "gemini" && error) {
    return `Evaluation: Gemini failed: ${error}`;
  }
  if (ran === "gemini") {
    return "Evaluation: Gemini";
  }
  if (ran === "stub") {
    return "Evaluation: stub";
  }
  return "Evaluation: unknown";
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
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
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

function ReportSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-medium text-neutral-900">{title}</h2>
      <div className="mt-2 text-sm leading-6 text-neutral-700">{children}</div>
    </section>
  );
}

function SessionReport({
  evaluation,
  error,
  transcript,
  interviewerNotes,
  serviceLine,
  retrying,
  onRetry,
  onRestart,
}: {
  evaluation: Evaluation | null;
  error: string | null;
  transcript: TranscriptLine[];
  interviewerNotes: InterviewerNote[];
  serviceLine: string | null;
  retrying: boolean;
  onRetry: (() => void) | null;
  onRestart: () => void;
}) {
  return (
    <div className="flex h-full justify-center overflow-y-auto px-8 py-10">
      <div className="w-full max-w-2xl">
        <h1 className="text-xl font-medium tracking-tight text-neutral-900">
          Session report
        </h1>
        {serviceLine ? (
          <p className="mt-2 text-xs text-neutral-400">{serviceLine}</p>
        ) : null}
        {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
        {evaluation ? (
          <>
            <p className="mt-2 text-sm tabular-nums text-neutral-500">
              {evaluation.coverage.revealedCount} of {evaluation.coverage.totalCount}{" "}
              facts · {evaluation.coverage.criticalRevealedCount} of{" "}
              {evaluation.coverage.criticalTotal} critical
            </p>
            <p className="mt-5 text-sm leading-6 text-pretty text-neutral-800">
              {evaluation.summary}
            </p>
            {evaluation.framing ? (
              <ReportSection title="How you framed the problem">
                <p>{evaluation.framing}</p>
              </ReportSection>
            ) : null}
            {evaluation.boardVsTalk ? (
              <ReportSection title="Board versus talking">
                <p className="tabular-nums">{evaluation.boardVsTalk}</p>
              </ReportSection>
            ) : null}
            {transcript.length > 0 ? (
              <ReportSection title={`What we heard (${transcript.length})`}>
                <ul className="space-y-2">
                  {transcript.map((line, index) => (
                    <li key={`${line.atMs}-${index}`}>
                      <span className="tabular-nums text-neutral-400">
                        {formatClock(line.atMs)}
                      </span>{" "}
                      {line.text}
                    </li>
                  ))}
                </ul>
              </ReportSection>
            ) : (
              <ReportSection title="What we heard">
                <p>Nothing was transcribed this round.</p>
              </ReportSection>
            )}
            {evaluation.rewrittenMoment.rewritten ? (
              <ReportSection title="One rewritten moment">
                {evaluation.rewrittenMoment.original ? (
                  <p className="text-neutral-500">
                    At {evaluation.rewrittenMoment.at}: “
                    {evaluation.rewrittenMoment.original}”
                  </p>
                ) : null}
                <p className="mt-2">{evaluation.rewrittenMoment.rewritten}</p>
              </ReportSection>
            ) : null}
            {evaluation.canvasMatch ? (
              <ReportSection title="Does the board match what you said">
                <p>{evaluation.canvasMatch}</p>
              </ReportSection>
            ) : null}
            {interviewerNotes.length > 0 ? (
              <ReportSection title="Interviewer notes">
                <ul className="space-y-2">
                  {interviewerNotes.map((note, index) => (
                    <li key={`${note.atMs}-${index}`}>
                      <span className="tabular-nums text-neutral-400">
                        {formatClock(note.atMs)}
                      </span>{" "}
                      {note.text}
                    </li>
                  ))}
                </ul>
              </ReportSection>
            ) : null}
            {evaluation.factsFound.length > 0 ? (
              <ReportSection title="Facts you found">
                <ul className="list-disc space-y-1 pl-5">
                  {evaluation.factsFound.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </ReportSection>
            ) : null}
            {evaluation.factsMissed.length > 0 ? (
              <ReportSection title="Facts you missed">
                <ul className="list-disc space-y-1 pl-5">
                  {evaluation.factsMissed.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </ReportSection>
            ) : null}
          </>
        ) : null}
        <div className="mt-10 flex flex-wrap items-center gap-3">
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 transition-transform duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {retrying ? "Retrying…" : "Retry evaluation"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onRestart}
            disabled={retrying}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition-transform duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Start another session
          </button>
        </div>
      </div>
    </div>
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

    const groqReady = fetch("/api/transcribe")
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
  const headerPrompt = selectedPrompt?.brief ?? "";

  return (
    <div className="flex h-dvh flex-col bg-neutral-50">
      {running ? null : (
      <header className="relative z-20 flex shrink-0 items-center gap-4 border-b border-neutral-200 bg-white px-5 py-2.5">
        <Countdown endsAt={endsAt} running={false} onExpire={finishSession} />
        <div className="relative min-w-0 flex-1">
          {headerPrompt ? (
            <>
              <button
                type="button"
                aria-expanded={promptOpen}
                onClick={() => setPromptOpen((open) => !open)}
                className="flex w-full items-center gap-2 text-left"
              >
                <span className="min-w-0 flex-1 truncate text-sm leading-5 text-neutral-700">
                  {headerPrompt}
                </span>
                <span
                  aria-hidden="true"
                  className={`shrink-0 text-neutral-400 transition-transform duration-150 ease-[cubic-bezier(0.2,0,0,1)] ${
                    promptOpen ? "rotate-180" : ""
                  }`}
                >
                  ▾
                </span>
              </button>
              {promptOpen ? (
                <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-30 rounded-lg border border-neutral-200 bg-white p-3 text-sm leading-6 text-neutral-800 shadow-[0_8px_24px_oklch(0_0_0/0.08)]">
                  {headerPrompt}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
        {status === "idle" ? (
          <button
            type="button"
            onClick={startSession}
            disabled={!promptId}
            className="shrink-0 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition-transform duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Start session
          </button>
        ) : null}
      </header>
      )}

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
          <PromptPicker selectedId={promptId} onSelect={setPromptId} />
        )}
      </main>
    </div>
  );
}
