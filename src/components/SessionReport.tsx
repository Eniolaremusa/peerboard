import { type ReactNode } from "react";
import { formatClock } from "@/config/session";
import { type InterviewerNote } from "@/components/SessionRoom";

export type TranscriptLine = {
  atMs: number;
  text: string;
  speaker?: string;
};

export type Evaluation = {
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

function speakerLabel(speaker: string) {
  if (speaker === "candidate") {
    return "Candidate";
  }
  if (speaker === "interviewer") {
    return "Interviewer";
  }
  return speaker;
}

export function evaluationLine(ran?: string, error?: string) {
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

export default function SessionReport({
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
                      {line.speaker ? (
                        <span className="text-neutral-500">
                          {speakerLabel(line.speaker)}{" "}
                        </span>
                      ) : null}
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
