export const sessionConfig = {
  durationMinutes: 45,
} as const;

export const sessionDurationMs = sessionConfig.durationMinutes * 60 * 1000;
