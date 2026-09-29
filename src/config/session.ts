export const sessionConfig = {
  durationMinutes: 45,
  snapshotIntervalMs: 15_000,
  liveSliceMs: 12_000,
} as const;

export const sessionDurationMs = sessionConfig.durationMinutes * 60 * 1000;

export function formatClock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
