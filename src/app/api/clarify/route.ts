import { prompts } from "@/config/prompts";
import { generateReply, ModelError } from "@/lib/model";

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

function parseModelJson(text: string): ClarifyResponse | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(trimmed) as {
      answer?: unknown;
      revealedFactIds?: unknown;
    };
    if (typeof parsed.answer !== "string") {
      return null;
    }
    const ids = Array.isArray(parsed.revealedFactIds)
      ? parsed.revealedFactIds.filter((id): id is string => typeof id === "string")
      : [];
    return { answer: parsed.answer, revealedFactIds: ids };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  let body: ClarifyRequest;
  try {
    body = (await request.json()) as ClarifyRequest;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const question = body.question?.trim();
  if (!question) {
    return Response.json({ error: "Question is required" }, { status: 400 });
  }

  const prompt =
    prompts.find((item) => item.id === body.promptId) ?? prompts[0];
  if (!prompt) {
    return Response.json({ error: "No prompt configured" }, { status: 500 });
  }

  const knownIds = new Set(prompt.facts.map((fact) => fact.id));
  const alreadyRevealed = (body.revealedFactIds ?? []).filter((id) =>
    knownIds.has(id),
  );

  let text: string;
  try {
    text = await generateReply(buildSystemPrompt(prompt, alreadyRevealed), question);
  } catch (error) {
    if (error instanceof ModelError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const parsed = parseModelJson(text);
  if (!parsed) {
    return Response.json({ error: "Could not parse model response" }, { status: 502 });
  }

  const revealedFactIds = parsed.revealedFactIds.filter((id) => knownIds.has(id));

  return Response.json({
    answer: parsed.answer,
    revealedFactIds,
  } satisfies ClarifyResponse);
}
