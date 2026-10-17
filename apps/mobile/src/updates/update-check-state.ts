/**
 * When the updater is allowed to go look.
 *
 * Split out from the hook so the throttle -- the part that decides how often a
 * user's phone talks to the CDN -- is testable without React Native.
 */

/** Six hours. Binaries ship far more slowly than this; the check is cheap but not free. */
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * Ignore an `active` transition that lands within this window of the last one.
 *
 * Returning from the system installer fires `active` immediately, so without
 * this the app would re-check, re-prompt and re-download the moment the user
 * backs out of an install they just declined.
 */
export const UPDATE_REENTRY_GUARD_MS = 30 * 1000

export function shouldCheckNow(input: {
  lastCheckedAtMs: number | null
  nowMs: number
  /** A user tapping "Check for updates" bypasses automatic-check throttles. */
  force?: boolean
}): boolean {
  const { lastCheckedAtMs, nowMs, force } = input
  if (force || lastCheckedAtMs === null) return true
  const elapsed = nowMs - lastCheckedAtMs
  // A clock that jumped backwards leaves a negative elapsed; treat the stored
  // stamp as unusable rather than never checking again.
  if (elapsed < 0) return true
  return elapsed >= UPDATE_CHECK_INTERVAL_MS
}
