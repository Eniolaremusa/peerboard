"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { sessionConfig, sessionDurationMs } from "@/config/session";
import "@excalidraw/excalidraw/index.css";

const Excalidraw = dynamic(
  async () => (await import("@excalidraw/excalidraw")).Excalidraw,
  { ssr: false },
);

type SessionStatus = "idle" | "active";

function formatCountdown(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
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

export default function WhiteboardSession() {
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [endsAt, setEndsAt] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);

  const endSession = useCallback(() => {
    setStatus("idle");
    setEndsAt(null);
  }, []);

  const startSession = () => {
    setEndsAt(new Date(Date.now() + sessionDurationMs).toISOString());
    setStatus("active");
    setPromptOpen(false);
  };

  const running = status === "active";

  return (
    <div className="flex h-dvh flex-col bg-neutral-50">
      <header className="relative z-20 flex shrink-0 items-center gap-4 border-b border-neutral-200 bg-white px-5 py-2.5">
        <Countdown endsAt={endsAt} running={running} onExpire={endSession} />

        <div className="relative min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={promptOpen}
            onClick={() => setPromptOpen((open) => !open)}
            className="flex w-full items-center gap-2 text-left"
          >
            <span className="min-w-0 flex-1 truncate text-sm leading-5 text-neutral-700">
              {sessionConfig.prompt}
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
              {sessionConfig.prompt}
            </div>
          ) : null}
        </div>

        {running ? (
          <button
            type="button"
            onClick={endSession}
            className="shrink-0 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 transition-transform duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96]"
          >
            End session
          </button>
        ) : (
          <button
            type="button"
            onClick={startSession}
            className="shrink-0 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition-transform duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96]"
          >
            Start session
          </button>
        )}
      </header>

      <main className="min-h-0 flex-1">
        {running ? (
          <div className="peerboard h-full w-full">
            <Excalidraw
              aiEnabled={false}
              initialData={{ appState: { viewBackgroundColor: "#FFFFFF" } }}
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-neutral-500">
              Start a session to open the whiteboard.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
