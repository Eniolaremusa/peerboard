import { getPrompt } from "@/config/prompts";
import {
  mintToken,
  newBoardKey,
  newEndsAt,
  parseRoomMeta,
  participantRole,
  roomService,
} from "@/lib/livekit";
import { otherRole, parseRole } from "@/lib/room";

export async function POST(request: Request) {
  const svc = roomService();
  if (!svc) {
    return Response.json(
      { error: "LiveKit is not configured" },
      { status: 500 },
    );
  }

  let body: {
    action?: string;
    promptId?: string;
    role?: string;
    roomId?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const role = parseRole(body.role);
  if (!role) {
    return Response.json({ error: "Choose candidate or interviewer" }, { status: 400 });
  }

  if (body.action === "create") {
    const prompt = getPrompt(body.promptId);
    if (!prompt) {
      return Response.json({ error: "Unknown prompt" }, { status: 400 });
    }
    const roomId = crypto.randomUUID();
    const endsAt = newEndsAt();
    const boardKey = newBoardKey();
    await svc.createRoom({
      name: roomId,
      emptyTimeout: 60 * 60,
      maxParticipants: 2,
      metadata: JSON.stringify({
        promptId: prompt.id,
        hostRole: role,
        endsAt,
        boardKey,
      }),
    });
    const minted = await mintToken(roomId, role);
    return Response.json({
      roomId,
      role,
      promptId: prompt.id,
      endsAt,
      boardKey,
      shareRole: otherRole(role),
      ...minted,
    });
  }

  if (body.action === "join") {
    const roomId = body.roomId?.trim();
    if (!roomId) {
      return Response.json({ error: "Missing room" }, { status: 400 });
    }
    const rooms = await svc.listRooms([roomId]);
    const room = rooms[0];
    if (!room) {
      return Response.json({ error: "This room has closed" }, { status: 404 });
    }
    const meta = parseRoomMeta(room.metadata);
    if (!meta) {
      return Response.json({ error: "This room is not ready" }, { status: 404 });
    }
    if (meta.endedAt) {
      return Response.json({ error: "This session has ended" }, { status: 410 });
    }
    const people = await svc.listParticipants(roomId);
    if (people.length >= 2) {
      return Response.json({ error: "This room is full" }, { status: 409 });
    }
    const taken = people
      .map((person) => participantRole(person.metadata))
      .filter((item): item is NonNullable<typeof item> => item !== null);
    if (taken.includes(role)) {
      return Response.json(
        { error: `Someone is already the ${role}` },
        { status: 409 },
      );
    }
    const minted = await mintToken(roomId, role);
    return Response.json({
      roomId,
      role,
      promptId: meta.promptId,
      endsAt: meta.endsAt,
      boardKey: meta.boardKey,
      shareRole: otherRole(role),
      ...minted,
    });
  }

  if (body.action === "end") {
    const roomId = body.roomId?.trim();
    if (!roomId) {
      return Response.json({ error: "Missing room" }, { status: 400 });
    }
    const rooms = await svc.listRooms([roomId]);
    const room = rooms[0];
    if (!room) {
      return Response.json({ error: "This room has closed" }, { status: 404 });
    }
    const meta = parseRoomMeta(room.metadata);
    if (!meta) {
      return Response.json({ error: "This room is not ready" }, { status: 404 });
    }
    if (!meta.endedAt) {
      await svc.updateRoomMetadata(
        roomId,
        JSON.stringify({
          ...meta,
          endedAt: new Date().toISOString(),
        }),
      );
    }
    return Response.json({ ok: true, roomId });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
