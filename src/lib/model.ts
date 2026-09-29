import { prompts } from "@/config/prompts";
import { formatClock } from "@/config/session";

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";

export type GenerateKind = "clarify" | "evaluate";

export type ModelImage = {
  mimeType: string;
  data: string;
};

export class ModelError extends Error {
  status: number;
  body: string;

  constructor(message: string, status: number, body = "") {
    super(message);
    this.name = "ModelError";
    this.status = status;
    this.body = body;
  }
}

export function extractJson(text: string) {
  let trimmed = text.trim();
  trimmed = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  trimmed = trimmed.replace(/```(?:json)?/gi, "").replace(/```/g, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1).trim();
  }
  return trimmed;
}

export function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    let parsed: unknown = JSON.parse(extractJson(text));
    if (typeof parsed === "string") {
      parsed = JSON.parse(parsed);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function words(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

export function stubReply(question: string) {
  const facts = prompts.flatMap((prompt) => prompt.facts);
  const questionWords = words(question);
  let best:
    | { id: string; fact: string; score: number }
    | undefined;

  for (const fact of facts) {
    const unlockedWords = new Set(words(fact.unlockedBy));
    const score = questionWords.filter((word) => unlockedWords.has(word)).length;
    if (score > 0 && (!best || score > best.score)) {
      best = { id: fact.id, fact: fact.fact, score };
    }
  }

  if (!best) {
    return JSON.stringify({
      answer: "I'm not sure",
      revealedFactIds: [],
    });
  }

  return JSON.stringify({
    answer: best.fact,
    revealedFactIds: [best.id],
  });
}

function pickSpokenLine(transcript: { atMs?: number; text?: string }[]) {
  const lines = transcript
    .map((line) => ({
      atMs: line.atMs ?? 0,
      text: line.text?.trim() ?? "",
    }))
    .filter((line) => line.text);
  if (lines.length === 0) {
    return undefined;
  }
  const filler = /^(okay|ok|so|um|uh|like|right|yeah|yes|alright)(?:\s+(okay|ok|so|um|uh|like|right|yeah|yes|alright))*$/i;
  return [...lines].sort((a, b) => {
    const aFill = filler.test(a.text) ? 0 : 1;
    const bFill = filler.test(b.text) ? 0 : 1;
    if (aFill !== bFill) {
      return bFill - aFill;
    }
    return b.text.length - a.text.length;
  })[0];
}

export function modelFailureReason(error: ModelError) {
  if (error.status === 503) {
    return "Gemini was overloaded (503)";
  }
  if (error.status === 429) {
    return "Gemini rate-limited (429)";
  }
  return error.message || `Gemini failed: ${error.status}`;
}

export function stubEvaluate(user: string, reason?: string) {
  let revealedFactIds: string[] = [];
  let transcript: { atMs?: number; text?: string }[] = [];
  let talkMs = 0;
  let boardMs = 0;
  let snapshotCount = 0;
  let hasSnapshot = false;

  try {
    const parsed = JSON.parse(user) as {
      revealedFactIds?: string[];
      transcript?: { atMs?: number; text?: string }[];
      talkMs?: number;
      boardMs?: number;
      snapshotCount?: number;
      hasSnapshot?: boolean;
    };
    revealedFactIds = parsed.revealedFactIds ?? [];
    transcript = parsed.transcript ?? [];
    talkMs = parsed.talkMs ?? 0;
    boardMs = parsed.boardMs ?? 0;
    snapshotCount = parsed.snapshotCount ?? 0;
    hasSnapshot = Boolean(parsed.hasSnapshot);
  } catch {
    revealedFactIds = [];
  }

  const facts = prompts[0]?.facts ?? [];
  const revealed = new Set(revealedFactIds);
  const found = facts.filter((fact) => revealed.has(fact.id));
  const missed = facts.filter((fact) => !revealed.has(fact.id));
  const spoken = pickSpokenLine(transcript);
  const spokenAt = formatClock(spoken?.atMs ?? 0);
  const why = reason?.trim();

  const framing = found.some((fact) => fact.id === "real-problem")
    ? "You got to the real goal: cutting support load, not cutting returns."
    : "You stayed with the framed problem (returns) and did not reach the real goal in the brief.";

  const rewrittenMoment = spoken?.text
    ? {
        at: spokenAt,
        original: spoken.text,
        rewritten: `At ${spokenAt} you said “${spoken.text}”. A tighter version: name the user, the constraint, and what you want to learn, then wait.`,
      }
    : talkMs > 0
      ? {
          at: "0:00",
          original: "",
          rewritten: `You spoke for ${formatClock(talkMs)}, but there is no transcript to rewrite.`,
        }
      : {
          at: "0:00",
          original: "",
          rewritten:
            "There was no spoken transcript to rewrite. Next round, talk through the problem out loud so the report can point at a moment.",
        };

  let canvasMatch: string;
  if (why) {
    canvasMatch = hasSnapshot
      ? `Evaluation could not run (${why}). The board was not compared with what you said.`
      : `Evaluation could not run (${why}). No canvas snapshot was captured, so there is no board to compare with what you said.`;
  } else if (hasSnapshot) {
    canvasMatch =
      "A snapshot was taken. Evaluation could not run, so the board was not compared with what you said.";
  } else {
    canvasMatch =
      "No canvas snapshot was captured, so there is no board to compare with what you said.";
  }

  return JSON.stringify({
    summary: `You uncovered ${found.length} of ${facts.length} facts. Board time ${formatClock(boardMs)}, talking ${formatClock(talkMs)}, ${snapshotCount} canvas snapshots.`,
    framing,
    boardVsTalk: `You spent ${formatClock(boardMs)} drawing and ${formatClock(talkMs)} talking.`,
    rewrittenMoment,
    canvasMatch,
    factsFound: found.map((fact) => fact.fact),
    factsMissed: missed.map((fact) => fact.fact),
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function geminiModels(kind: GenerateKind) {
  const preferred = process.env.GEMINI_MODEL?.trim();
  const models =
    kind === "clarify"
      ? ["gemini-3-flash-preview", preferred, "gemini-3.6-flash"]
      : [preferred, "gemini-3.6-flash", "gemini-3-flash-preview"];
  return [...new Set(models.filter((model): model is string => Boolean(model)))];
}

type GeminiPayload = {
  candidates?: {
    finishReason?: string;
    content?: { parts?: { text?: string; thought?: boolean }[] };
  }[];
};

function readGeminiText(payload: GeminiPayload) {
  const finishReason = payload.candidates?.[0]?.finishReason;
  if (finishReason) {
    console.log(`[model] finishReason=${finishReason}`);
  }
  const modelParts = payload.candidates?.[0]?.content?.parts ?? [];
  const visible = modelParts.filter((part) => !part.thought && part.text);
  return (visible.length > 0 ? visible : modelParts)
    .map((part) => part.text ?? "")
    .join("");
}

export async function generateReply(
  system: string,
  user: string,
  kind: GenerateKind = "clarify",
  images: ModelImage[] = [],
): Promise<{ text: string; ran: "gemini" | "stub" }> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    console.log(`[model] mode=stub kind=${kind}`);
    return {
      text:
        kind === "evaluate"
          ? stubEvaluate(user, "missing Gemini API key")
          : stubReply(user),
      ran: "stub",
    };
  }

  const parts: Record<string, unknown>[] = [{ text: user }];
  for (const image of images) {
    parts.push({
      inlineData: {
        mimeType: image.mimeType,
        data: image.data,
      },
    });
  }

  const generationConfig: Record<string, unknown> = {
    responseMimeType: "application/json",
    maxOutputTokens: kind === "evaluate" ? 8192 : 1024,
  };
  if (kind === "evaluate") {
    generationConfig.responseSchema = evaluateResponseSchema;
  } else {
    generationConfig.responseSchema = clarifyResponseSchema;
  }

  const requestBody = {
    systemInstruction: {
      parts: [{ text: system }],
    },
    contents: [{ role: "user", parts }],
    generationConfig,
  };

  const waitsMs = kind === "clarify" ? [0, 600] : [0, 1000, 2000, 4000];
  let lastError: ModelError | undefined;

  for (const model of geminiModels(kind)) {
    for (let attempt = 0; attempt < waitsMs.length; attempt += 1) {
      const waitMs = waitsMs[attempt] ?? 0;
      if (waitMs > 0) {
        console.log(
          `[model] retry kind=${kind} model=${model} after ${lastError?.status ?? "error"} wait=${waitMs}ms`,
        );
        await sleep(waitMs);
      } else {
        console.log(`[model] mode=gemini kind=${kind} model=${model}`);
      }

      let response: Response;
      try {
        response = await fetch(`${GEMINI_API_URL}/${model}:generateContent`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify(requestBody),
        });
      } catch (error) {
        lastError = new ModelError(
          error instanceof Error ? error.message : "Gemini failed: network",
          502,
        );
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        const errorBody = await response.text();
        console.log("[model] gemini error", kind, model, response.status, errorBody);
        throw new ModelError(
          `Gemini failed: ${response.status}`,
          response.status,
          errorBody,
        );
      }

      if (!response.ok) {
        const errorBody = await response.text();
        console.log("[model] gemini error", kind, model, response.status, errorBody);
        lastError = new ModelError(
          `Gemini failed: ${response.status}`,
          response.status,
          errorBody,
        );
        if (
          response.status === 400 ||
          response.status === 404 ||
          (kind === "clarify" && response.status === 503)
        ) {
          break;
        }
        continue;
      }

      const payload = (await response.json()) as GeminiPayload;
      const text = readGeminiText(payload);
      if (!text) {
        const errorBody = JSON.stringify(payload);
        console.log("[model] gemini error", kind, model, "empty", errorBody);
        lastError = new ModelError("Gemini failed: empty", 502, errorBody);
        continue;
      }

      return { text, ran: "gemini" };
    }
  }

  throw lastError ?? new ModelError("Gemini failed", 502);
}

const clarifyResponseSchema = {
  type: "OBJECT",
  properties: {
    answer: { type: "STRING" },
    revealedFactIds: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["answer", "revealedFactIds"],
};

const evaluateResponseSchema = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    framing: { type: "STRING" },
    boardVsTalk: { type: "STRING" },
    rewrittenMoment: {
      type: "OBJECT",
      properties: {
        at: { type: "STRING" },
        original: { type: "STRING" },
        rewritten: { type: "STRING" },
      },
      required: ["at", "original", "rewritten"],
    },
    canvasMatch: { type: "STRING" },
    factsFound: { type: "ARRAY", items: { type: "STRING" } },
    factsMissed: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: [
    "summary",
    "framing",
    "boardVsTalk",
    "rewrittenMoment",
    "canvasMatch",
  ],
};
