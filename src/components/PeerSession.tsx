"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { LiveKitRoom, useRoomInfo } from "@livekit/components-react";
import { getPrompt } from "@/config/prompts";
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
import { LeaveRoomButton, PeerAudio, PeerVideo } from "@/components/PeerVideo";
import {
  PeerTranscribe,
  type PeerTranscribeHandle,
} from "@/components/PeerTranscribe";
import { otherRole, parseRole } from "@/lib/room";

const SharedBoard = dynamic(() => import("@/components/SharedBoard"), {
  ssr: false,
});

type BoardApi = {
  getSceneElements: () => readonly unknown[];
  getAppState: () => Record<string, unknown>;
  getFiles: () => Record<string, unknown> | null;
};

type TokenPayload = {
  token?: string;
  role?: Role;
  promptId?: string;
  endsAt?: string;
  boardKey?: string;
  shareRole?: Role;
  error?: string;
};

type PeerStatus = "live" | "evaluating" | "report";

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export default function PeerSession({
  roomId,
  roleHint,
}: {
  roomId: string;
  roleHint: string | undefined;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(parseRole(roleHint));
  const [promptId, setPromptId] = useState<string | null>(null);
  const [endsAt, setEndsAt] = useState<string | null>(null);
  const [boardKey, setBoardKey] = useState<string | null>(null);
  const [shareRole, setShareRole] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [stage, setStage] = useState<CandidateStage>("board");
  const [notes, setNotes] = useState("");
  const [railTab, setRailTab] = useState<RailTab>("prompt");
  const [promptOpen, setPromptOpen] = useState(false);
  const [revealedFactIds] = useState<string[]>([]);
  const [interviewerNotes, setInterviewerNotes] = useState<InterviewerNote[]>(
    [],
  );
  const [startedAt] = useState(() => Date.now());
  const [status, setStatus] = useState<PeerStatus>("live");
  const [micStatus, setMicStatus] = useState<"off" | "listening">("off");
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [serviceLine, setServiceLine] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const evaluatePayloadRef = useRef<{
    promptId: string;
    revealedFactIds: string[];
    turns: never[];
    transcript: TranscriptLine[];
    interviewerNotes: InterviewerNote[];
    talkMs: number;
    boardMs: number;
    elapsedMs: number;
    snapshotCount: number;
    lastSnapshot?: { mimeType: string; data: string };
  } | null>(null);
  const finishingRef = useRef(false);
  const retryingRef = useRef(false);
  const apiRef = useRef<BoardApi | null>(null);
  const transcribeRef = useRef<PeerTranscribeHandle | null>(null);
  const transcriptRef = useRef<TranscriptLine[]>([]);
  const interviewerNotesRef = useRef(interviewerNotes);
  interviewerNotesRef.current = interviewerNotes;

  useEffect(() => {
    const role = parseRole(roleHint);
    if (!role) {
      setError("This link is missing a role.");
      return;
    }
    let cancelled = false;
    const join = async () => {
      try {
        const response = await fetch("/api/livekit/token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "join", roomId, role }),
        });
        const payload = (await response.json()) as TokenPayload;
        if (cancelled) {
          return;
        }
        if (
          !payload.token ||
          !payload.role ||
          !payload.promptId ||
          !payload.endsAt ||
          !payload.boardKey
        ) {
          setError(payload.error ?? "Could not join this room");
          return;
        }
        setToken(payload.token);
        setRole(payload.role);
        setPromptId(payload.promptId);
        setEndsAt(payload.endsAt);
        setBoardKey(payload.boardKey);
        setShareRole(payload.shareRole ?? otherRole(payload.role));
      } catch {
        if (!cancelled) {
          setError("Could not join this room");
        }
      }
    };
    void join();
    return () => {
      cancelled = true;
    };
  }, [roomId, roleHint]);

  const leave = useCallback(() => {
    window.location.assign("/");
  }, []);

  const captureBoard = useCallback(async () => {
    const api = apiRef.current;
    if (!api) {
      return undefined;
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
      return {
        mimeType: "image/jpeg",
        data: dataUrl.split(",")[1] ?? "",
      };
    } catch {
      return undefined;
    }
  }, []);

  const requestEvaluation = useCallback(
    async (body: NonNullable<typeof evaluatePayloadRef.current>) => {
      const response = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as Evaluation & {
        error?: string;
        services?: { evaluation?: { ran?: string; error?: string } };
      };
      setServiceLine(
        evaluationLine(
          payload.services?.evaluation?.ran,
          payload.services?.evaluation?.error,
        ),
      );
      if (payload.summary) {
        setEvaluation(payload);
        setReportError(null);
        return;
      }
      throw new Error(payload.error ?? "Could not write the report");
    },
    [],
  );

  const finishSession = useCallback(async () => {
    if (finishingRef.current || !promptId) {
      return;
    }
    finishingRef.current = true;
    const lastSnapshot = await captureBoard();
    const spoken =
      (await transcribeRef.current?.flush()) ?? transcriptRef.current;
    transcriptRef.current = spoken;
    setTranscript(spoken);
    const notesNow = interviewerNotesRef.current;
    const evaluateBody = {
      promptId,
      revealedFactIds: [],
      turns: [] as never[],
      transcript: spoken,
      interviewerNotes: notesNow,
      talkMs: 0,
      boardMs: 0,
      elapsedMs: Date.now() - startedAt,
      snapshotCount: lastSnapshot ? 1 : 0,
      lastSnapshot,
    };
    evaluatePayloadRef.current = evaluateBody;
    setStatus("evaluating");
    try {
      await requestEvaluation(evaluateBody);
    } catch (err) {
      setServiceLine((current) => current ?? evaluationLine());
      setReportError(
        err instanceof Error ? err.message : "Could not write the report",
      );
    } finally {
      setStatus("report");
    }
  }, [captureBoard, promptId, requestEvaluation, startedAt]);

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

  const requestEnd = useCallback(async () => {
    if (finishingRef.current) {
      return;
    }
    try {
      await fetch("/api/livekit/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "end", roomId, role }),
      });
    } catch {
      // Finish locally even if the room update did not land.
    }
    await finishSession();
  }, [finishSession, role, roomId]);

  const copyLink = async () => {
    if (!shareRole) {
      return;
    }
    const url = `${window.location.origin}/room/${roomId}?role=${shareRole}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this link", url);
    }
  };

  const serverUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  const prompt = promptId ? getPrompt(promptId) : undefined;

  if (error) {
    return (
      <div className="flex h-dvh items-center justify-center bg-neutral-50">
        <p className="text-sm text-red-700">{error}</p>
      </div>
    );
  }

  if (status === "evaluating") {
    return (
      <div className="flex h-dvh items-center justify-center bg-neutral-50">
        <p className="text-sm text-neutral-500">Writing the session report…</p>
      </div>
    );
  }

  if (status === "report") {
    return (
      <div className="flex h-dvh flex-col bg-neutral-50">
        <SessionReport
          evaluation={evaluation}
          error={reportError}
          transcript={transcript}
          interviewerNotes={interviewerNotes}
          serviceLine={serviceLine}
          retrying={retrying}
          onRetry={evaluatePayloadRef.current ? retryEvaluation : null}
          onRestart={leave}
        />
      </div>
    );
  }

  if (!token || !role || !prompt || !endsAt || !boardKey || !serverUrl) {
    return (
      <div className="flex h-dvh items-center justify-center bg-neutral-50">
        <p className="text-sm text-neutral-500">
          {serverUrl ? "Joining the room…" : "LiveKit URL is missing."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-neutral-50">
      <LiveKitRoom
        serverUrl={serverUrl}
        token={token}
        connect
        video
        audio
        className="flex min-h-0 flex-1 flex-col"
        onDisconnected={() => {
          if (!finishingRef.current) {
            leave();
          }
        }}
      >
        <RoomEndListener onEnded={finishSession} />
        <PeerTranscribe
          startedAt={startedAt}
          localRole={role}
          handleRef={transcribeRef}
          onLines={(lines) => {
            transcriptRef.current = lines;
          }}
          onStatus={setMicStatus}
        />
        <SessionRoom
          role={role}
          onRoleChange={() => undefined}
          showRoleToggle={false}
          stage={stage}
          onToggleBoard={() =>
            setStage((current) => (current === "board" ? "video" : "board"))
          }
          onOpenNotes={() => setStage("notes")}
          notes={notes}
          onNotesChange={setNotes}
          railTab={railTab}
          onRailTab={setRailTab}
          prompt={prompt}
          revealedFactIds={revealedFactIds}
          promptOpen={promptOpen}
          onTogglePrompt={() => setPromptOpen((open) => !open)}
          micStatus={micStatus}
          timer={<PeerCountdown endsAt={endsAt} onExpire={requestEnd} />}
          onEnd={requestEnd}
          endControl={
            <>
              <button
                type="button"
                onClick={() => void requestEnd()}
                className="shrink-0 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 transition-transform duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96]"
              >
                End session
              </button>
              <LeaveRoomButton />
            </>
          }
          share={
            <button
              type="button"
              onClick={() => void copyLink()}
              className="shrink-0 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 transition-transform duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96]"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          }
          video={<PeerVideo layout="full" />}
          tiles={<PeerVideo layout="tiles" />}
          board={
            <SharedBoard
              roomId={roomId}
              boardKey={boardKey}
              role={role}
              onBoardApi={(api) => {
                apiRef.current = api;
              }}
            />
          }
          interviewerNotes={interviewerNotes}
          onAddInterviewerNote={(text) => {
            setInterviewerNotes((current) => [
              ...current,
              { atMs: Date.now() - startedAt, text },
            ]);
          }}
        />
        <PeerAudio />
      </LiveKitRoom>
    </div>
  );
}

function RoomEndListener({ onEnded }: { onEnded: () => void }) {
  const { metadata } = useRoomInfo();

  useEffect(() => {
    if (!metadata) {
      return;
    }
    try {
      const parsed = JSON.parse(metadata) as { endedAt?: unknown };
      if (typeof parsed.endedAt === "string" && parsed.endedAt) {
        onEnded();
      }
    } catch {
      // Ignore malformed room metadata.
    }
  }, [metadata, onEnded]);

  return null;
}

function PeerCountdown({
  endsAt,
  onExpire,
}: {
  endsAt: string;
  onExpire: () => void;
}) {
  const [remainingMs, setRemainingMs] = useState(() =>
    Math.max(0, Date.parse(endsAt) - Date.now()),
  );

  useEffect(() => {
    let expired = false;
    const tick = () => {
      const remaining = Date.parse(endsAt) - Date.now();
      if (remaining <= 0) {
        setRemainingMs(0);
        if (!expired) {
          expired = true;
          onExpire();
        }
        return;
      }
      setRemainingMs(remaining);
    };
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [endsAt, onExpire]);

  return (
    <time
      dateTime={`PT${Math.floor(remainingMs / 1000)}S`}
      className="shrink-0 tabular-nums text-sm font-medium tracking-tight text-neutral-900"
    >
      {formatPeerClock(remainingMs)}
    </time>
  );
}

function formatPeerClock(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
