"use client";

import {
  DisconnectButton,
  RoomAudioRenderer,
  TrackMutedIndicator,
  TrackToggle,
  VideoTrack,
  isTrackReference,
  useIsMuted,
  useTracks,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-react";
import { Track } from "livekit-client";

export function PeerVideo({ layout }: { layout: "full" | "tiles" }) {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.Microphone, withPlaceholder: true },
    ],
    { onlySubscribed: false },
  );
  const localParticipant = tracks.find((track) => track.participant.isLocal)
    ?.participant;
  const remoteParticipant = tracks.find((track) => !track.participant.isLocal)
    ?.participant;
  const local = faceTracks(tracks, localParticipant);
  const remote = faceTracks(tracks, remoteParticipant);

  if (layout === "full") {
    return (
      <div className="relative h-full w-full bg-neutral-800">
        <CameraFace
          camera={remote.camera}
          microphone={remote.microphone}
          label="Peer"
          className="h-full w-full"
        />
        <div className="absolute bottom-3 right-3 z-10 w-28">
          <div className="aspect-square overflow-hidden rounded-lg">
            <CameraFace
              camera={local.camera}
              microphone={local.microphone}
              label="You"
              className="h-full w-full"
            />
          </div>
          <MediaToggles />
        </div>
      </div>
    );
  }

  return (
    <div className="absolute right-3 top-3 z-20 flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <div className="aspect-square w-24 overflow-hidden rounded-lg">
          <CameraFace
            camera={local.camera}
            microphone={local.microphone}
            label="You"
            className="h-full w-full"
          />
        </div>
        <div className="aspect-square w-24 overflow-hidden rounded-lg">
          <CameraFace
            camera={remote.camera}
            microphone={remote.microphone}
            label="Peer"
            className="h-full w-full"
          />
        </div>
      </div>
      <MediaToggles />
    </div>
  );
}

export function PeerAudio() {
  return <RoomAudioRenderer />;
}

export function LeaveRoomButton() {
  return (
    <DisconnectButton className="shrink-0 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 transition-transform duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96]">
      Leave room
    </DisconnectButton>
  );
}

function MediaToggles() {
  return (
    <div className="mt-1 flex justify-end gap-1">
      <TrackToggle
        source={Track.Source.Microphone}
        aria-label="Microphone"
        className="peer-media-toggle"
      />
      <TrackToggle
        source={Track.Source.Camera}
        aria-label="Camera"
        className="peer-media-toggle"
      />
    </div>
  );
}

function faceTracks(
  tracks: ReturnType<typeof useTracks>,
  participant: ReturnType<typeof useTracks>[number]["participant"] | undefined,
) {
  if (!participant) {
    return { camera: undefined, microphone: undefined };
  }
  return {
    camera: tracks.find(
      (track) =>
        track.participant.identity === participant.identity &&
        track.source === Track.Source.Camera,
    ),
    microphone: tracks.find(
      (track) =>
        track.participant.identity === participant.identity &&
        track.source === Track.Source.Microphone,
    ),
  };
}

function CameraFace({
  camera,
  microphone,
  label,
  className,
}: {
  camera: ReturnType<typeof useTracks>[number] | undefined;
  microphone: ReturnType<typeof useTracks>[number] | undefined;
  label: string;
  className?: string;
}) {
  return (
    <div
      className={`relative bg-neutral-800 outline outline-1 outline-black/10 ${className ?? ""}`}
    >
      {camera ? <FaceVideo trackRef={camera} /> : null}
      <div className="absolute right-1 top-1 z-10 flex gap-0.5">
        {microphone ? (
          <TrackMutedIndicator
            trackRef={microphone}
            show="muted"
            className="peer-mute-chip"
          />
        ) : null}
        {camera ? (
          <TrackMutedIndicator
            trackRef={camera}
            show="muted"
            className="peer-mute-chip"
          />
        ) : null}
      </div>
      <div className="absolute bottom-1 left-1 z-10 max-w-[calc(100%-0.5rem)] text-[10px] leading-3 text-white">
        <span className="block truncate">{label}</span>
        {microphone ? (
          <MutedSuffix trackRef={microphone} text="Muted" />
        ) : null}
        {camera ? (
          <MutedSuffix trackRef={camera} text="Camera off" />
        ) : null}
      </div>
    </div>
  );
}

function FaceVideo({
  trackRef,
}: {
  trackRef: TrackReferenceOrPlaceholder;
}) {
  const muted = useIsMuted(trackRef);
  if (muted || !isTrackReference(trackRef)) {
    return null;
  }
  return (
    <VideoTrack trackRef={trackRef} className="h-full w-full object-cover" />
  );
}

function MutedSuffix({
  trackRef,
  text,
}: {
  trackRef: TrackReferenceOrPlaceholder;
  text: string;
}) {
  const muted = useIsMuted(trackRef);
  return muted ? <span className="block">{text}</span> : null;
}
