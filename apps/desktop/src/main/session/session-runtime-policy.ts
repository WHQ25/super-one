export const SESSION_RUNTIME_REAPER_INTERVAL_MS = 30_000

const TWENTY_MINUTES_MS = 20 * 60 * 1000
const TEN_MINUTES_MS = 10 * 60 * 1000
const FIVE_MINUTES_MS = 5 * 60 * 1000

export function getRuntimeIdleTimeoutMs(activeRuntimeCount: number): number {
  if (activeRuntimeCount <= 4) return TWENTY_MINUTES_MS
  if (activeRuntimeCount <= 8) return TEN_MINUTES_MS
  return FIVE_MINUTES_MS
}
