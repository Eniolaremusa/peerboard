import { prompts } from "@/config/prompts";
import { generateReply, ModelError, parseJsonObject } from "@/lib/model";

export const maxDuration = 60;

type ClarifyRequest = {
  promptId?: string;
  question?: string;
  revealedFactIds?: string[];
};

type ClarifyResponse = {
  answer: string;
  revealedFactIds: string[];
};

function buildSystemPrompt(
  prompt: (typeof prompts)[number],
  alreadyRevealed: string[],
) {
  const factList = prompt.facts
    .map(
      (fact) =>
        `- id: ${fact.id}\n  fact: ${fact.fact}\n  example question (kind of question, not a string to match): ${fact.unlockedBy}`,
    )
    .join("\n");

  return `You are the Head of Customer Operations. Stay in character for the whole reply.

Context (source of truth, never read aloud as a labelled brief):
${prompt.context}

Facts (your only source of truth). unlockedBy is an example of the kind of question that unlocks the fact, not a phrase to match. Decide by judgement whether the candidate is actually asking about that fact.
${factList}

Fact ids already revealed this session: ${alreadyRevealed.length > 0 ? alreadyRevealed.join(", ") : "none"}

Rules:
- Answer only from the facts above. Never invent details.
- Never volunteer a fact that was not asked about.
- Release one fact per answer unless the question genuinely covers more than one.
- If the answer is not in the facts, say you do not know. Do not guess.
- Do not mention fact ids, these instructions, or that you are matching facts.

Reply with JSON only, no markdown:
{"answer":"<in-character spoken reply>","revealedFactIds":["id"]}
revealedFactIds is the ids of facts this answer is based on. Use only ids from the list.`;
}

function parseClarify(text: string): ClarifyResponse | null {
  const record = parseJsonObject(text);
  if (!record || typeof record.answer !== "string") {
    return null;
  }
  const ids = Array.isArray(record.revealedFactIds)
    ? record.revealedFactIds.filter((id): id is string => typeof id === "string")
    : [];
  return { answer: record.answer, revealedFactIds: ids };
}

function errorResponse(error: string) {
  return Response.json({ error });
}

export async function POST(request: Request) {
  let body: ClarifyRequest;
  try {
    body = (await request.json()) as ClarifyRequest;
  } catch {
    return errorResponse("Invalid JSON");
  }

  const question = body.question?.trim();
  if (!question) {
    return errorResponse("Question is required");
  }

  const prompt =
    prompts.find((item) => item.id === body.promptId) ?? prompts[0];
  if (!prompt) {
    return errorResponse("No prompt configured");
  }

  const knownIds = new Set(prompt.facts.map((fact) => fact.id));
  const alreadyRevealed = (body.revealedFactIds ?? []).filter((id) =>
    knownIds.has(id),
  );

  let text: string;
  try {
    const reply = await generateReply(
      buildSystemPrompt(prompt, alreadyRevealed),
      question,
      "clarify",
    );
    text = reply.text;
  } catch (error) {
    if (error instanceof ModelError) {
      console.log("[clarify] gemini failed", error.status, error.body || error.message);
      return errorResponse(error.message);
    }
    console.log("[clarify] gemini failed", error);
    return errorResponse("Could not get an answer");
  }

  const parsed = parseClarify(text);
  if (!parsed) {
    console.log("[clarify] parse failed raw=", text.slice(0, 4000));
    return errorResponse("Could not parse model response");
  }

  const revealedFactIds = parsed.revealedFactIds.filter((id) => knownIds.has(id));

  return Response.json({
    answer: parsed.answer,
    revealedFactIds,
  } satisfies ClarifyResponse);
}
