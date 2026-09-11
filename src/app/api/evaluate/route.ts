import { prompts } from "@/config/prompts";
import { rubric } from "@/config/rubric";
import { generateReply, ModelError } from "@/lib/model";

export const maxDuration = 60;

type TranscriptLine = {
  atMs?: number;
  text?: string;
};

type EvaluateRequest = {
  promptId?: string;
  revealedFactIds?: string[];
  turns?: { question?: string; answer?: string }[];
  transcript?: TranscriptLine[];
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
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(trimmed) as {
      summary?: unknown;
      framing?: unknown;
      boardVsTalk?: unknown;
      rewrittenMoment?: {
        at?: unknown;
        original?: unknown;
        rewritten?: unknown;
      };
      canvasMatch?: unknown;
      factsFound?: unknown;
      factsMissed?: unknown;
    };
    if (typeof parsed.summary !== "string") {
      return null;
    }
    const moment = parsed.rewrittenMoment;
    return {
      summary: parsed.summary,
      framing: typeof parsed.framing === "string" ? parsed.framing : "",
      boardVsTalk: typeof parsed.boardVsTalk === "string" ? parsed.boardVsTalk : "",
      rewrittenMoment: {
        at: typeof moment?.at === "string" ? moment.at : "0:00",
        original: typeof moment?.original === "string" ? moment.original : "",
        rewritten: typeof moment?.rewritten === "string" ? moment.rewritten : "",
      },
      canvasMatch: typeof parsed.canvasMatch === "string" ? parsed.canvasMatch : "",
      factsFound: asStringArray(parsed.factsFound),
      factsMissed: asStringArray(parsed.factsMissed),
    };
  } catch {
    return null;
  }
}

function buildSystemPrompt(prompt: (typeof prompts)[number]) {
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

The session JSON is ground truth for revealed fact ids, transcript timestamps, and board vs talk times. If a canvas image is attached, use it only to judge whether the board matches what they said they were doing. If audio is attached, transcribe the candidate and treat that transcription as the spoken transcript, even when the transcript array is empty.

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

  const prompt =
    prompts.find((item) => item.id === body.promptId) ?? prompts[0];
  if (!prompt) {
    return Response.json({ error: "No prompt configured" }, { status: 500 });
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
    revealedFactIds,
    turns,
    transcript,
    talkMs,
    boardMs,
    elapsedMs,
    snapshotCount,
    hasSnapshot: Boolean(snapshot?.data),
    hasRecording: Boolean(recording?.data),
    coverage,
  };

  let text: string;
  try {
    text = await generateReply(
      buildSystemPrompt(prompt),
      JSON.stringify(payload),
      "evaluate",
      media,
    );
  } catch (error) {
    if (error instanceof ModelError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const written = parseWritten(text);
  if (!written) {
    return Response.json({ error: "Could not parse model response" }, { status: 502 });
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
  });
}
