import PeerSession from "@/components/PeerSession";

export default async function RoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<{ role?: string }>;
}) {
  const { roomId } = await params;
  const { role } = await searchParams;
  return <PeerSession roomId={roomId} roleHint={role} />;
}
