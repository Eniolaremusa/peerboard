"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { type Prompt } from "@/config/prompts";
import { formatClock } from "@/config/session";

export type Role = "candidate" | "interviewer";
export type CandidateStage = "board" | "video" | "notes";
export type RailTab = "prompt" | "notes" | "evaluation";
export type InterviewerNote = { atMs: number; text: string };

type SessionRoomProps = {
  role: Role;
  onRoleChange: (role: Role) => void;
  showRoleToggle: boolean;
  stage: CandidateStage;
  onToggleBoard: () => void;
  onOpenNotes: () => void;
  notes: string;
  onNotesChange: (value: string) => void;
  railTab: RailTab;
  onRailTab: (tab: RailTab) => void;
  prompt: Prompt;
  revealedFactIds: string[];
  promptOpen: boolean;
  onTogglePrompt: () => void;
  micStatus: "off" | "listening" | "blocked";
  timer: ReactNode;
  onEnd: () => void;
  board: ReactNode;
  ask: ReactNode;
  interviewerNotes: InterviewerNote[];
  onAddInterviewerNote: (text: string) => void;
};

function VideoPlaceholder({ label }: { label?: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-neutral-800 outline outline-1 outline-black/10">
      <p className="text-sm text-neutral-400">{label ?? "Video"}</p>
    </div>
  );
}

function VideoTiles() {
  return (
    <div className="absolute right-3 top-3 z-20 flex gap-2">
      <div className="flex aspect-square w-24 items-end rounded-lg bg-neutral-800 p-2 outline outline-1 outline-black/10">
        <p className="text-xs text-white">You</p>
      </div>
      <div className="flex aspect-square w-24 items-end rounded-lg bg-neutral-800 p-2 outline outline-1 outline-black/10">
        <p className="text-xs text-white">Peer</p>
      </div>
    </div>
  );
}

function StageCard({
  label,
  pressed,
  onClick,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`aspect-square w-28 rounded-lg border px-3 py-3 text-sm font-medium transition-[border-color,transform] duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96] ${
        pressed
          ? "border-neutral-900 bg-white text-neutral-900"
          : "border-neutral-200 bg-white text-neutral-700"
      }`}
    >
      {label}
    </button>
  );
}

export default function SessionRoom({
  role,
  onRoleChange,
  showRoleToggle,
  stage,
  onToggleBoard,
  onOpenNotes,
  notes,
  onNotesChange,
  railTab,
  onRailTab,
  prompt,
  revealedFactIds,
  promptOpen,
  onTogglePrompt,
  micStatus,
  timer,
  onEnd,
  board,
  ask,
  interviewerNotes,
  onAddInterviewerNote,
}: SessionRoomProps) {
  const revealed = new Set(revealedFactIds);
  const showBoard = role === "interviewer" || stage === "board";
  const showNotes = role === "candidate" && stage === "notes";
  const showFullVideo = role === "candidate" && stage === "video";
  const showTiles = role === "candidate" && stage !== "video";

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-neutral-50">
      <div className="absolute inset-x-0 top-0 z-30 flex items-center gap-3 border-b border-neutral-200/80 bg-white/90 px-4 py-2">
        {timer}
        {micStatus === "listening" ? (
          <p className="shrink-0 text-xs text-neutral-500">Listening</p>
        ) : null}
        {micStatus === "blocked" ? (
          <p className="shrink-0 text-xs text-red-700">Mic blocked</p>
        ) : null}
        <div className="relative min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={promptOpen}
            onClick={onTogglePrompt}
            className="flex w-full items-center gap-2 text-left"
          >
            <span className="min-w-0 flex-1 truncate text-sm leading-5 text-neutral-700">
              {prompt.brief}
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
              {prompt.brief}
            </div>
          ) : null}
        </div>
        {showRoleToggle ? (
          <div className="flex shrink-0 rounded-md border border-neutral-200 bg-white p-0.5">
            <button
              type="button"
              aria-pressed={role === "candidate"}
              onClick={() => onRoleChange("candidate")}
              className={`rounded px-2 py-1 text-xs font-medium transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)] ${
                role === "candidate"
                  ? "bg-neutral-900 text-white"
                  : "text-neutral-600"
              }`}
            >
              Candidate
            </button>
            <button
              type="button"
              aria-pressed={role === "interviewer"}
              onClick={() => onRoleChange("interviewer")}
              className={`rounded px-2 py-1 text-xs font-medium transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)] ${
                role === "interviewer"
                  ? "bg-neutral-900 text-white"
                  : "text-neutral-600"
              }`}
            >
              Interviewer
            </button>
          </div>
        ) : null}
        <button
          type="button"
          onClick={onEnd}
          className="shrink-0 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 transition-transform duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96]"
        >
          End session
        </button>
      </div>

      <div
        className={`min-h-0 flex-1 pt-12 ${
          role === "interviewer"
            ? "grid grid-cols-[7fr_3fr]"
            : "flex flex-col"
        }`}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <div
              className={`peerboard absolute inset-0 ${
                showBoard ? "z-10" : "invisible pointer-events-none"
              }`}
            >
              {board}
            </div>
            {showFullVideo ? (
              <div className="absolute inset-0 z-10">
                <VideoPlaceholder />
              </div>
            ) : null}
            {showNotes ? (
              <textarea
                value={notes}
                onChange={(event) => onNotesChange(event.target.value)}
                placeholder="Private notes"
                className="absolute inset-0 z-10 resize-none bg-white p-5 text-sm leading-6 text-neutral-800 outline-none"
              />
            ) : null}
            {showTiles ? <VideoTiles /> : null}
          </div>
          {role === "candidate" ? ask : null}
          {role === "candidate" ? (
            <div className="flex shrink-0 justify-center gap-3 bg-white px-5 py-3">
              <StageCard
                label="Whiteboard"
                pressed={stage === "board"}
                onClick={onToggleBoard}
              />
              <StageCard
                label="Notes"
                pressed={stage === "notes"}
                onClick={onOpenNotes}
              />
            </div>
          ) : null}
        </div>
        {role === "interviewer" ? (
          <aside className="flex min-h-0 min-w-0 flex-col border-l border-neutral-200 bg-white">
            <div className="flex shrink-0 border-b border-neutral-200">
              <RailTabButton
                label="Prompt"
                pressed={railTab === "prompt"}
                onClick={() => onRailTab("prompt")}
              />
              <RailTabButton
                label="Notes"
                pressed={railTab === "notes"}
                onClick={() => onRailTab("notes")}
              />
              <RailTabButton
                label="Evaluation"
                pressed={railTab === "evaluation"}
                onClick={() => onRailTab("evaluation")}
              />
            </div>
            {railTab === "prompt" ? (
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                <h2 className="text-sm font-medium text-neutral-900">
                  {prompt.title}
                </h2>
                <p className="mt-2 text-sm leading-6 text-neutral-700">
                  {prompt.context}
                </p>
                <h3 className="mt-6 text-sm font-medium text-neutral-900">
                  Facts
                </h3>
                <ul className="mt-2 space-y-3">
                  {prompt.facts.map((fact) => {
                    const isRevealed = revealed.has(fact.id);
                    return (
                      <li key={fact.id}>
                        <p className="text-xs text-neutral-500">
                          {isRevealed ? "Revealed" : "Not yet asked"}
                        </p>
                        <p className="mt-0.5 text-sm leading-6 text-neutral-800">
                          {fact.fact}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            {railTab === "notes" ? (
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                {interviewerNotes.length > 0 ? (
                  <ul>
                    {interviewerNotes.map((note, index) => (
                      <li
                        key={`${note.atMs}-${index}`}
                        className="border-b border-neutral-100 py-2 text-sm leading-6 text-neutral-800 first:pt-0 last:border-b-0"
                      >
                        <span className="tabular-nums text-neutral-400">
                          {formatClock(note.atMs)}
                        </span>{" "}
                        {note.text}
                      </li>
                    ))}
                  </ul>
                ) : (
                    <p className="text-sm leading-6 text-neutral-500">
                      No notes yet.
                    </p>
                )}
              </div>
            ) : null}
            {railTab === "evaluation" ? (
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                <p className="text-sm leading-6 text-neutral-500">
                  The scorecard will live here in a later pass.
                </p>
              </div>
            ) : null}
            {railTab !== "evaluation" ? (
              <NoteComposer onAdd={onAddInterviewerNote} />
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function RailTabButton({
  label,
  pressed,
  onClick,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`flex-1 px-2 py-2.5 text-sm font-medium transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)] ${
        pressed
          ? "border-b-2 border-neutral-900 text-neutral-900"
          : "text-neutral-500"
      }`}
    >
      {label}
    </button>
  );
}

function NoteComposer({ onAdd }: { onAdd: (text: string) => void }) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const text = draft.trim();
    if (!text) {
      return;
    }
    onAdd(text);
    setDraft("");
  };

  return (
    <form
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        commit();
      }}
      className="shrink-0 border-t border-neutral-200 px-4 py-3"
    >
      <input
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          commit();
        }}
        placeholder="Private note"
        className="w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus-visible:border-neutral-500"
      />
    </form>
  );
}
