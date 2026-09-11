import { groqConfigured, transcribeAudio } from "@/lib/transcribe";

export const maxDuration = 60;

export async function GET() {
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
    const message =
      error instanceof Error ? error.message : "Transcription failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
