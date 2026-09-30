"use client";

import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { useTracks } from "@livekit/components-react";
import { Track } from "livekit-client";
import { startWhisperSlicer } from "@/lib/whisper-slice";
import { otherRole, type Role } from "@/lib/room";
import { type TranscriptLine } from "@/components/SessionReport";

export type PeerTranscribeHandle = {
  flush: () => Promise<TranscriptLine[]>;
};

export function PeerTranscribe({
  startedAt,
  localRole,
  onLines,
  onStatus,
  handleRef,
}: {
  startedAt: number;
  localRole: Role;
  onLines: (lines: TranscriptLine[]) => void;
  onStatus: (status: "listening" | "off") => void;
  handleRef: MutableRefObject<PeerTranscribeHandle | null>;
}) {
  const tracks = useTracks([Track.Source.Microphone], {
    onlySubscribed: false,
  });
  const [groqOk, setGroqOk] = useState(false);
  const linesRef = useRef<TranscriptLine[]>([]);
  const stoppedRef = useRef(false);
  const onLinesRef = useRef(onLines);
  onLinesRef.current = onLines;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const slicersRef = useRef(new Map<string, { stop: () => Promise<void> }>());
  const startedAtRef = useRef(startedAt);
  startedAtRef.current = startedAt;

  const trackKey = tracks
    .map((track) => {
      const mediaId = track.publication.track?.mediaStreamTrack?.id ?? "none";
      return `${track.participant.identity}:${mediaId}`;
    })
    .sort()
    .join("|");

  useEffect(() => {
    console.log("[transcribe] capture=livekit");
    let cancelled = false;
    void fetch("/api/transcribe?capture=livekit", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as { available?: boolean };
        if (!cancelled) {
          setGroqOk(Boolean(payload.available));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGroqOk(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const slicers = slicersRef.current;
    if (stoppedRef.current || !groqOk) {
      if (!stoppedRef.current) {
        onStatusRef.current("off");
      }
      return;
    }

    const wanted = new Map<
      string,
      { stream: MediaStream; speaker: Role; capture: string }
    >();
    let hasLocal = false;
    for (const track of tracks) {
      const media = track.publication.track?.mediaStreamTrack;
      if (!media || media.readyState === "ended") {
        continue;
      }
      const speaker = track.participant.isLocal
        ? localRole
        : otherRole(localRole);
      const side = track.participant.isLocal ? "local" : "remote";
      if (track.participant.isLocal) {
        hasLocal = true;
      }
      wanted.set(`${track.participant.identity}:${media.id}`, {
        stream: new MediaStream([media]),
        speaker,
        capture: `livekit-${side}`,
      });
    }

    onStatusRef.current(hasLocal ? "listening" : "off");

    for (const [id, slicer] of slicers) {
      if (!wanted.has(id)) {
        void slicer.stop();
        slicers.delete(id);
      }
    }

    for (const [id, spec] of wanted) {
      if (slicers.has(id)) {
        continue;
      }
      try {
        slicers.set(
          id,
          startWhisperSlicer({
            stream: spec.stream,
            startedAt: () => startedAtRef.current,
            capture: spec.capture,
            speaker: spec.speaker,
            onSegments: (segments) => {
              const labelled = segments.map((line) => ({
                ...line,
                speaker: spec.speaker,
              }));
              linesRef.current = [...linesRef.current, ...labelled].sort(
                (a, b) => a.atMs - b.atMs,
              );
              onLinesRef.current(linesRef.current);
            },
          }),
        );
      } catch {
        // Skip tracks the browser cannot record.
      }
    }
  }, [groqOk, localRole, trackKey, tracks]);

  useEffect(() => {
    handleRef.current = {
      flush: async () => {
        stoppedRef.current = true;
        const pending = [...slicersRef.current.values()].map((slicer) =>
          slicer.stop(),
        );
        slicersRef.current.clear();
        await Promise.all(pending);
        return linesRef.current;
      },
    };
    return () => {
      handleRef.current = null;
      for (const slicer of slicersRef.current.values()) {
        void slicer.stop();
      }
      slicersRef.current.clear();
    };
  }, [handleRef]);

  return null;
}
