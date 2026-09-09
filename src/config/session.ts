export const sessionConfig = {
  durationMinutes: 45,
  prompt:
    "A restaurant on a food-delivery app keeps missing incoming orders during the dinner rush. Diagnose the problem and propose a solution. Walk through your thinking on the whiteboard.",
} as const;

export const sessionDurationMs = sessionConfig.durationMinutes * 60 * 1000;
