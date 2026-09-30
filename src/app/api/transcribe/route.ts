import { groqConfigured, transcribeAudio, TranscribeError } from "@/lib/transcribe";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function captureLabel(capture: string | null, speaker: string | null) {
  const path = capture?.trim() || "unknown";
  const who = speaker?.trim();
  return who ? `${path} speaker=${who}` : path;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const capture = url.searchParams.get("capture");
  if (capture) {
    console.log(`[transcribe] session capture=${captureLabel(capture, null)}`);
  }
  return Response.json({ available: groqConfigured() });
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Missing audio file" }, { status: 400 });
  }

  const offsetMs = Number(form.get("offsetMs") ?? 0);
  const capture = typeof form.get("capture") === "string" ? String(form.get("capture")) : "";
  const speaker = typeof form.get("speaker") === "string" ? String(form.get("speaker")) : "";
  console.log(`[transcribe] capture=${captureLabel(capture, speaker)}`);
  const bytes = await file.arrayBuffer();

  try {
    const result = await transcribeAudio({
      bytes,
      mimeType: file.type || "audio/webm",
      filename: file.name,
      offsetMs: Number.isFinite(offsetMs) ? offsetMs : 0,
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof TranscribeError) {
      return Response.json(
        { error: error.message, status: error.status },
        { status: error.status },
      );
    }
    const message =
      error instanceof Error ? error.message : "Transcription failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
