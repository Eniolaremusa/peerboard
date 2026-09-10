import { prompts } from "@/config/prompts";

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";

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

export async function generateReply(system: string, user: string) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    console.log("[model] mode=stub");
    return stubReply(user);
  }

  console.log("[model] mode=gemini");

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
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 512,
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
