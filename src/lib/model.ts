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

  constructor(message: string, status: number) {
    super(message);
    this.name = "ModelError";
    this.status = status;
  }
}

function words(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

function stubReply(question: string) {
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

function stubEvaluate(user: string) {
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
          rewritten: `You spoke for ${formatClock(talkMs)}, but there is no transcript to rewrite yet. With a Gemini key the recording can be transcribed after the session.`,
        }
      : {
          at: "0:00",
          original: "",
          rewritten:
            "There was no spoken transcript to rewrite. Next round, talk through the problem out loud so the report can point at a moment.",
        };

  return JSON.stringify({
    summary: `You uncovered ${found.length} of ${facts.length} facts. Board time ${formatClock(boardMs)}, talking ${formatClock(talkMs)}, ${snapshotCount} canvas snapshots.`,
    framing,
    boardVsTalk: `You spent ${formatClock(boardMs)} drawing and ${formatClock(talkMs)} talking.`,
    rewrittenMoment,
    canvasMatch: hasSnapshot
      ? "A snapshot was taken. This stub cannot judge whether the board matches what you said; add a Gemini key for that check."
      : "No canvas snapshot was captured, so there is no board to compare with what you said.",
    factsFound: found.map((fact) => fact.fact),
    factsMissed: missed.map((fact) => fact.fact),
  });
}

export async function generateReply(
  system: string,
  user: string,
  kind: GenerateKind = "clarify",
  images: ModelImage[] = [],
) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    console.log(`[model] mode=stub kind=${kind}`);
    return kind === "evaluate" ? stubEvaluate(user) : stubReply(user);
  }

  console.log(`[model] mode=gemini kind=${kind}`);

  const parts: Record<string, unknown>[] = [{ text: user }];
  for (const image of images) {
    parts.push({
      inlineData: {
        mimeType: image.mimeType,
        data: image.data,
      },
    });
  }

  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const response = await fetch(`${GEMINI_API_URL}/${model}:generateContent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: system }],
      },
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: kind === "evaluate" ? 2048 : 512,
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new ModelError(`Model request failed: ${detail}`, 502);
  }

  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("");

  if (!text) {
    throw new ModelError("Empty model response", 502);
  }

  return text;
}
