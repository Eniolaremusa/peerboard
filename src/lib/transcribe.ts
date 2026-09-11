const GROQ_TRANSCRIBE_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";

const WHISPER_PROMPT =
  "A spoken design interview about a clothing retailer's returns process, support tickets, a self-serve portal, and store versus app.";

export type TranscriptSegment = {
  atMs: number;
  text: string;
};

export type TranscribeResult = {
  text: string;
  segments: TranscriptSegment[];
  mode: "groq" | "stub";
};

export function groqConfigured() {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

function extensionFor(mimeType: string) {
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) {
    return "mp4";
  }
  if (mimeType.includes("wav")) {
    return "wav";
  }
  return "webm";
}

export async function transcribeAudio({
  bytes,
  mimeType,
  filename,
  offsetMs = 0,
}: {
  bytes: ArrayBuffer;
  mimeType: string;
  filename?: string;
  offsetMs?: number;
}): Promise<TranscribeResult> {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    console.log("[transcribe] mode=stub");
    return { text: "", segments: [], mode: "stub" };
  }

  console.log("[transcribe] mode=groq");

  const type = mimeType || "audio/webm";
  const name = filename || `audio.${extensionFor(type)}`;
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type }), name);
  form.append("model", process.env.GROQ_TRANSCRIBE_MODEL ?? "whisper-large-v3-turbo");
  form.append("language", "en");
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");
  form.append("timestamp_granularities[]", "segment");
  form.append("prompt", WHISPER_PROMPT);

  const response = await fetch(GROQ_TRANSCRIBE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Transcription failed: ${detail}`);
  }

  const payload = (await response.json()) as {
    text?: string;
    segments?: { start?: number; text?: string }[];
  };
  const text = payload.text?.replace(/\s+/g, " ").trim() ?? "";
  const segments = (payload.segments ?? [])
    .map((segment) => ({
      atMs: offsetMs + Math.max(0, Math.round((segment.start ?? 0) * 1000)),
      text: segment.text?.replace(/\s+/g, " ").trim() ?? "",
    }))
    .filter((segment) => segment.text);

  if (segments.length === 0 && text) {
    return {
      text,
      segments: [{ atMs: offsetMs, text }],
      mode: "groq",
    };
  }

  return { text, segments, mode: "groq" };
}
