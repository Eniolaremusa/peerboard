"use client";

import { useEffect, useRef, useState } from "react";
import {
  CaptureUpdateAction,
  Excalidraw,
  getSceneVersion,
  reconcileElements,
  restoreElements,
} from "@excalidraw/excalidraw";
import { io, type Socket } from "socket.io-client";
import {
  collabServerUrl,
  decryptBytes,
  encryptBytes,
  toUint8Array,
} from "@/lib/excalidraw-crypto";
import { type Role } from "@/lib/room";
import "@excalidraw/excalidraw/index.css";

type BoardApi = {
  getSceneElementsIncludingDeleted: () => readonly unknown[];
  getSceneElements: () => readonly unknown[];
  getAppState: () => Record<string, unknown>;
  getFiles: () => Record<string, unknown> | null;
  updateScene: (data: Record<string, unknown>) => void;
};

type SceneMessage = {
  type: "SCENE_INIT" | "SCENE_UPDATE";
  payload: { elements: readonly unknown[] };
};

type PointerMessage = {
  type: "MOUSE_LOCATION";
  payload: {
    socketId: string;
    pointer: { x: number; y: number; tool: "pointer" | "laser" };
    button: "up" | "down";
    selectedElementIds: Record<string, boolean>;
    username: string;
  };
};

type CollabMessage = SceneMessage | PointerMessage | { type: string };

const cursorColor = {
  Candidate: { background: "#83C4EA", stroke: "#277FB2" },
  Interviewer: { background: "#E8C07D", stroke: "#8A6A2F" },
};

function throttle<Args extends unknown[]>(
  fn: (...args: Args) => void,
  wait: number,
) {
  let last = 0;
  let timer = 0;
  let queued: Args | null = null;
  const run = (args: Args) => {
    last = Date.now();
    queued = null;
    fn(...args);
  };
  return (...args: Args) => {
    const remaining = wait - (Date.now() - last);
    queued = args;
    if (remaining <= 0) {
      if (timer) {
        window.clearTimeout(timer);
        timer = 0;
      }
      run(args);
      return;
    }
    if (!timer) {
      timer = window.setTimeout(() => {
        timer = 0;
        if (queued) {
          run(queued);
        }
      }, remaining);
    }
  };
}

export default function SharedBoard({
  roomId,
  boardKey,
  role,
  onBoardApi,
}: {
  roomId: string;
  boardKey: string;
  role: Role;
  onBoardApi?: (api: BoardApi) => void;
}) {
  const serverUrl = collabServerUrl();
  const apiRef = useRef<BoardApi | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const readyRef = useRef(false);
  const pendingInitRef = useRef(false);
  const pendingRemoteRef = useRef<readonly unknown[] | null>(null);
  const sceneVersionRef = useRef(-1);
  const collaboratorsRef = useRef(new Map<string, Record<string, unknown>>());
  const sendInitRef = useRef<() => void>(() => undefined);
  const applyRemoteRef = useRef<(elements: readonly unknown[]) => void>(
    () => undefined,
  );
  const username = role === "candidate" ? "Candidate" : "Interviewer";
  const [status, setStatus] = useState<"connecting" | "live" | "error">(
    serverUrl ? "connecting" : "error",
  );

  useEffect(() => {
    if (!serverUrl || !boardKey) {
      setStatus("error");
      return;
    }

    const socket = io(serverUrl, {
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;
    let cancelled = false;

    const emitEncrypted = async (
      event: "server-broadcast" | "server-volatile-broadcast",
      data: unknown,
    ) => {
      if (!readyRef.current || !socket.connected) {
        return;
      }
      const { encryptedBuffer, iv } = await encryptBytes(
        boardKey,
        JSON.stringify(data),
      );
      socket.emit(event, roomId, encryptedBuffer, iv);
    };

    const broadcastScene = async (
      type: SceneMessage["type"],
      syncAll: boolean,
    ) => {
      const api = apiRef.current;
      if (!api) {
        if (type === "SCENE_INIT") {
          pendingInitRef.current = true;
        }
        return;
      }
      if (type === "SCENE_UPDATE" && role !== "candidate") {
        return;
      }
      const elements = api.getSceneElementsIncludingDeleted();
      const version = getSceneVersion(elements as never);
      if (type === "SCENE_UPDATE" && !syncAll && version <= sceneVersionRef.current) {
        return;
      }
      if (type === "SCENE_UPDATE") {
        sceneVersionRef.current = version;
      }
      await emitEncrypted("server-broadcast", {
        type,
        payload: { elements },
      });
    };
    sendInitRef.current = () => {
      void broadcastScene("SCENE_INIT", true);
    };

    const applyRemoteScene = (elements: readonly unknown[]) => {
      const api = apiRef.current;
      if (!api) {
        pendingRemoteRef.current = elements;
        return;
      }
      const local = api.getSceneElementsIncludingDeleted();
      const restored = restoreElements(elements as never, local as never);
      const reconciled = reconcileElements(
        local as never,
        restored as never,
        api.getAppState() as never,
      );
      sceneVersionRef.current = getSceneVersion(reconciled);
      api.updateScene({
        elements: reconciled,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    };
    applyRemoteRef.current = applyRemoteScene;

    const publishCollaborators = () => {
      apiRef.current?.updateScene({
        collaborators: new Map(collaboratorsRef.current),
      });
    };

    socket.on("init-room", () => {
      socket.emit("join-room", roomId);
    });

    socket.on("first-in-room", () => {
      readyRef.current = true;
      if (!cancelled) {
        setStatus("live");
      }
    });

    socket.on("new-user", () => {
      void broadcastScene("SCENE_INIT", true);
    });

    socket.on("room-user-change", (clients: string[]) => {
      readyRef.current = true;
      if (!cancelled) {
        setStatus("live");
      }
      const next = new Map<string, Record<string, unknown>>();
      for (const id of clients) {
        const existing = collaboratorsRef.current.get(id) ?? {};
        next.set(id, {
          ...existing,
          isCurrentUser: id === socket.id,
          username:
            id === socket.id
              ? username
              : (existing.username as string | undefined),
        });
      }
      collaboratorsRef.current = next;
      publishCollaborators();
    });

    socket.on("client-broadcast", async (encryptedData: unknown, iv: unknown) => {
      try {
        const decrypted = await decryptBytes(
          boardKey,
          toUint8Array(iv),
          toUint8Array(encryptedData),
        );
        const message = JSON.parse(
          new TextDecoder().decode(new Uint8Array(decrypted)),
        ) as CollabMessage;
        if (message.type === "SCENE_INIT") {
          if (!readyRef.current) {
            readyRef.current = true;
            if (!cancelled) {
              setStatus("live");
            }
          }
          applyRemoteScene((message as SceneMessage).payload.elements);
          return;
        }
        if (message.type === "SCENE_UPDATE") {
          applyRemoteScene((message as SceneMessage).payload.elements);
          return;
        }
        if (message.type === "MOUSE_LOCATION") {
          const payload = (message as PointerMessage).payload;
          const color =
            payload.username === "Interviewer"
              ? cursorColor.Interviewer
              : cursorColor.Candidate;
          collaboratorsRef.current.set(payload.socketId, {
            ...collaboratorsRef.current.get(payload.socketId),
            pointer: payload.pointer,
            button: payload.button,
            selectedElementIds: payload.selectedElementIds,
            username: payload.username,
            color,
            isCurrentUser: payload.socketId === socket.id,
          });
          publishCollaborators();
        }
      } catch {
        // Drop a bad frame; the next scene sync will catch up.
      }
    });

    socket.on("connect_error", () => {
      if (!cancelled) {
        setStatus("error");
      }
    });

    socket.on("connect", () => {
      if (!cancelled && readyRef.current) {
        setStatus("live");
      }
    });

    const fullSync = window.setInterval(() => {
      void broadcastScene("SCENE_UPDATE", true);
    }, 20_000);

    return () => {
      cancelled = true;
      window.clearInterval(fullSync);
      readyRef.current = false;
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [boardKey, role, roomId, serverUrl, username]);

  const onPointerUpdate = useRef(
    throttle(
      (payload: {
        pointer: { x: number; y: number; tool: "pointer" | "laser" };
        button: "down" | "up";
        pointersMap: Map<number, unknown>;
      }) => {
        const socket = socketRef.current;
        if (!socket?.id || !readyRef.current || (payload.pointersMap?.size ?? 0) > 1) {
          return;
        }
        const selectedElementIds = (apiRef.current?.getAppState()
          .selectedElementIds ?? {}) as Record<string, boolean>;
        void (async () => {
          const { encryptedBuffer, iv } = await encryptBytes(
            boardKey,
            JSON.stringify({
              type: "MOUSE_LOCATION",
              payload: {
                socketId: socket.id,
                pointer: {
                  ...payload.pointer,
                  tool: role === "interviewer" ? "laser" : payload.pointer.tool,
                },
                button: payload.button,
                selectedElementIds,
                username,
              },
            }),
          );
          socket.emit(
            "server-volatile-broadcast",
            roomId,
            encryptedBuffer,
            iv,
          );
        })();
      },
      33,
    ),
  );

  if (!serverUrl) {
    return (
      <div className="flex h-full items-center justify-center bg-white">
        <p className="px-5 text-sm text-red-700">
          Canvas sync URL is missing. Set NEXT_PUBLIC_EXCALIDRAW_ROOM_URL and
          run the collab server.
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <Excalidraw
        aiEnabled={false}
        isCollaborating
        viewModeEnabled={role === "interviewer"}
        onPointerUpdate={onPointerUpdate.current}
        excalidrawAPI={(api) => {
          const board = api as unknown as BoardApi;
          apiRef.current = board;
          onBoardApi?.(board);
          if (pendingRemoteRef.current) {
            const elements = pendingRemoteRef.current;
            pendingRemoteRef.current = null;
            applyRemoteRef.current(elements);
          }
          if (pendingInitRef.current) {
            pendingInitRef.current = false;
            sendInitRef.current();
          }
        }}
        onChange={() => {
          if (role !== "candidate" || !readyRef.current || !apiRef.current) {
            return;
          }
          const elements = apiRef.current.getSceneElementsIncludingDeleted();
          const version = getSceneVersion(elements as never);
          if (version <= sceneVersionRef.current) {
            return;
          }
          sceneVersionRef.current = version;
          const socket = socketRef.current;
          if (!socket?.connected) {
            return;
          }
          void (async () => {
            const { encryptedBuffer, iv } = await encryptBytes(
              boardKey,
              JSON.stringify({
                type: "SCENE_UPDATE",
                payload: { elements },
              }),
            );
            socket.emit("server-broadcast", roomId, encryptedBuffer, iv);
          })();
        }}
        initialData={{ appState: { viewBackgroundColor: "#FFFFFF" } }}
      />
      {status === "connecting" ? (
        <p className="pointer-events-none absolute bottom-3 left-3 z-20 text-xs text-neutral-500">
          Connecting canvas…
        </p>
      ) : null}
      {status === "error" ? (
        <p className="pointer-events-none absolute bottom-3 left-3 z-20 text-xs text-red-700">
          Canvas could not connect. Is the sync server running?
        </p>
      ) : null}
    </div>
  );
}
