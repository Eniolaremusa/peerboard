import { randomBytes } from "node:crypto";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { sessionDurationMs } from "@/config/session";
import { parseRole, type Role } from "@/lib/room";

export type RoomMeta = {
  promptId: string;
  hostRole: Role;
  endsAt: string;
  boardKey: string;
  endedAt?: string;
};

export function newBoardKey() {
  return randomBytes(16).toString("base64url");
}

function livekitHttpUrl(wsUrl: string) {
  return wsUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}

export function livekitConfig() {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const wsUrl = process.env.LIVEKIT_URL ?? process.env.NEXT_PUBLIC_LIVEKIT_URL;
  if (!apiKey || !apiSecret || !wsUrl) {
    return null;
  }
  return {
    apiKey,
    apiSecret,
    wsUrl,
    httpUrl: livekitHttpUrl(wsUrl),
  };
}

export function roomService() {
  const config = livekitConfig();
  if (!config) {
    return null;
  }
  return new RoomServiceClient(config.httpUrl, config.apiKey, config.apiSecret);
}

export function parseRoomMeta(raw: string | undefined): RoomMeta | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<RoomMeta>;
    const hostRole = parseRole(parsed.hostRole);
    if (!parsed.promptId || !hostRole || !parsed.endsAt || !parsed.boardKey) {
      return null;
    }
    return {
      promptId: parsed.promptId,
      hostRole,
      endsAt: parsed.endsAt,
      boardKey: parsed.boardKey,
      endedAt:
        typeof parsed.endedAt === "string" ? parsed.endedAt : undefined,
    };
  } catch {
    return null;
  }
}

export function participantRole(metadata: string | undefined): Role | null {
  if (!metadata) {
    return null;
  }
  try {
    const parsed = JSON.parse(metadata) as { role?: unknown };
    return parseRole(parsed.role);
  } catch {
    return null;
  }
}

export function newEndsAt() {
  return new Date(Date.now() + sessionDurationMs).toISOString();
}

export async function mintToken(roomName: string, role: Role) {
  const config = livekitConfig();
  if (!config) {
    throw new Error("LiveKit is not configured");
  }
  const identity = `${role}-${crypto.randomUUID().slice(0, 8)}`;
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity,
    name: role === "candidate" ? "Candidate" : "Interviewer",
    ttl: "2h",
    metadata: JSON.stringify({ role }),
  });
  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
  });
  return { token: await token.toJwt(), identity };
}
