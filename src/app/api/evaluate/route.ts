import { getPrompt, type Prompt } from "@/config/prompts";
import { rubric } from "@/config/rubric";
import { generateReply, ModelError, modelFailureReason, parseJsonObject, stubEvaluate } from "@/lib/model";

export const maxDuration = 120;

type TranscriptLine = {
  atMs?: number;
  text?: string;
};

type EvaluateRequest = {
  promptId?: string;
  revealedFactIds?: string[];
  turns?: { question?: string; answer?: string }[];
  transcript?: TranscriptLine[];
  interviewerNotes?: TranscriptLine[];
  talkMs?: number;
  boardMs?: number;
  elapsedMs?: number;
  snapshotCount?: number;
  lastSnapshot?: { mimeType?: string; data?: string };
  recording?: { mimeType?: string; data?: string };
};

type WrittenEvaluation = {
  summary: string;
  framing: string;
  boardVsTalk: string;
  rewrittenMoment: { at: string; original: string; rewritten: string };
  canvasMatch: string;
  factsFound: string[];
  factsMissed: string[];
};

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parseWritten(text: string): WrittenEvaluation | null {
  const record = parseJsonObject(text);
  if (!record || typeof record.summary !== "string") {
    return null;
  }
  const moment = record.rewrittenMoment as
    | {
        at?: unknown;
        original?: unknown;
        rewritten?: unknown;
      }
    | undefined;
  return {
    summary: record.summary,
    framing: typeof record.framing === "string" ? record.framing : "",
    boardVsTalk: typeof record.boardVsTalk === "string" ? record.boardVsTalk : "",
    rewrittenMoment: {
      at: typeof moment?.at === "string" ? moment.at : "0:00",
      original: typeof moment?.original === "string" ? moment.original : "",
      rewritten: typeof moment?.rewritten === "string" ? moment.rewritten : "",
    },
    canvasMatch: typeof record.canvasMatch === "string" ? record.canvasMatch : "",
    factsFound: asStringArray(record.factsFound),
    factsMissed: asStringArray(record.factsMissed),
  };
}

function buildSystemPrompt(prompt: Prompt) {
  const factList = prompt.facts
    .map(
      (fact) =>
        `- id: ${fact.id}${fact.critical ? " (critical)" : ""}\n  fact: ${fact.fact}`,
    )
    .join("\n");

  return `You write the post-session evaluation for a design interview.

${rubric.instructions}

Context:
${prompt.context}

Facts in the hidden brief:
${factList}

The session JSON is ground truth for revealed fact ids, transcript timestamps, and board vs talk times. If interviewerNotes is present, those are private timestamped observations from the interviewer, not the candidate. You may cite them by time (m:ss) when they help explain the round. If a canvas image is attached, use it only to judge whether the board matches what they said they were doing. If audio is attached, transcribe the candidate and treat that transcription as the spoken transcript, even when the transcript array is empty.

Reply with JSON only, no markdown:
{"summary":"<2 to 4 sentences>","framing":"<how they framed the problem>","boardVsTalk":"<one sentence citing the times>","rewrittenMoment":{"at":"m:ss","original":"<their words>","rewritten":"<tighter version>"},"canvasMatch":"<does the board match what they said>","factsFound":["fact text"],"factsMissed":["fact text"]}`;
}

export async function POST(request: Request) {
  let body: EvaluateRequest;
  try {
    body = (await request.json()) as EvaluateRequest;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const prompt = getPrompt(body.promptId);
  if (!prompt) {
    return Response.json({ error: "Unknown prompt" }, { status: 400 });
  }

  const knownIds = new Set(prompt.facts.map((fact) => fact.id));
  const revealedFactIds = (body.revealedFactIds ?? []).filter((id) =>
    knownIds.has(id),
  );
  const revealed = new Set(revealedFactIds);
  const turns = (body.turns ?? [])
    .map((turn) => ({
      question: turn.question?.trim() ?? "",
      answer: turn.answer?.trim() ?? "",
    }))
    .filter((turn) => turn.question && turn.answer);
  const transcript = (body.transcript ?? [])
    .map((line) => ({
      atMs: typeof line.atMs === "number" ? line.atMs : 0,
      text: line.text?.trim() ?? "",
    }))
    .filter((line) => line.text);
  const interviewerNotes = (body.interviewerNotes ?? [])
    .map((line) => ({
      atMs: typeof line.atMs === "number" ? line.atMs : 0,
      text: line.text?.trim() ?? "",
    }))
    .filter((line) => line.text);

  const foundFacts = prompt.facts.filter((fact) => revealed.has(fact.id));
  const missedFacts = prompt.facts.filter((fact) => !revealed.has(fact.id));
  const critical = prompt.facts.filter((fact) => fact.critical);
  const coverage = {
    revealedCount: foundFacts.length,
    totalCount: prompt.facts.length,
    criticalRevealedCount: critical.filter((fact) => revealed.has(fact.id)).length,
    criticalTotal: critical.length,
    found: foundFacts.map((fact) => ({ fact: fact.fact })),
    missed: missedFacts.map((fact) => ({ fact: fact.fact })),
    missedCritical: critical
      .filter((fact) => !revealed.has(fact.id))
      .map((fact) => ({ fact: fact.fact })),
  };

  const talkMs = body.talkMs ?? 0;
  const boardMs = body.boardMs ?? 0;
  const elapsedMs = body.elapsedMs ?? 0;
  const snapshotCount = body.snapshotCount ?? 0;
  const snapshot = body.lastSnapshot;
  const recording = body.recording;
  const media = [
    ...(snapshot?.data && snapshot.mimeType
      ? [{ mimeType: snapshot.mimeType, data: snapshot.data }]
      : []),
    ...(recording?.data && recording.mimeType
      ? [{ mimeType: recording.mimeType, data: recording.data }]
      : []),
  ];

  const payload = {
    promptId: prompt.id,
    revealedFactIds,
    turns,
    transcript,
    interviewerNotes,
    talkMs,
    boardMs,
    elapsedMs,
    snapshotCount,
    hasSnapshot: Boolean(snapshot?.data),
    hasRecording: Boolean(recording?.data),
    coverage,
  };

  const sessionJson = JSON.stringify(payload);

  let text: string;
  let ran: "gemini" | "stub" = "stub";
  let evalError: string | undefined;
  try {
    const reply = await generateReply(
      buildSystemPrompt(prompt),
      sessionJson,
      "evaluate",
      media,
      prompt.id,
    );
    text = reply.text;
    ran = reply.ran;
  } catch (error) {
    if (error instanceof ModelError) {
      const why = modelFailureReason(error);
      console.log("[evaluate] gemini request failed", error.status, error.body || error.message);
      evalError = String(error.status);
      text = stubEvaluate(sessionJson, why);
      ran = "stub";
    } else {
      throw error;
    }
  }

  let written = parseWritten(text);
  if (!written) {
    console.log(
      "[evaluate] parse failed raw=",
      text.slice(0, 4000),
    );
    evalError = evalError ?? "bad JSON";
    written = parseWritten(stubEvaluate(sessionJson, "the model returned unreadable JSON"));
    ran = "stub";
  }

  if (!written) {
    return Response.json({ error: "Could not build a report" }, { status: 500 });
  }

  return Response.json({
    summary: written.summary,
    framing: written.framing,
    boardVsTalk: written.boardVsTalk,
    rewrittenMoment: written.rewrittenMoment,
    canvasMatch: written.canvasMatch,
    coverage,
    factsFound: coverage.found.map((item) => item.fact),
    factsMissed: coverage.missed.map((item) => item.fact),
    services: {
      evaluation: evalError ? { ran: "gemini" as const, error: evalError } : { ran },
    },
  });
}
