// Turn elements sit in document order, so their viewport-relative tops are monotonically
// non-decreasing. `topOf` returns null for a turn whose element is not mounted (lazy
// loading only mounts a contiguous suffix, so nulls form a top prefix = above threshold).
// Binary-search the last turn whose top is at/above the threshold — O(log n) rect reads.
export function findActiveTurnId(
  entries: { id: string }[],
  topOf: (id: string) => number | null,
  threshold: number,
): string | null {
  if (entries.length === 0) return null
  let lo = 0
  let hi = entries.length - 1
  let result = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const top = topOf(entries[mid].id)
    if (top === null || top <= threshold) {
      result = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return entries[result].id
}

export const TICK_MAX = 22
export const TICK_MIN = 6
const TICK_RANGE = 4

export function tickWidth(dist: number | null): number {
  if (dist === null || dist >= TICK_RANGE) return TICK_MIN
  const ease = (1 + Math.cos((Math.PI * dist) / TICK_RANGE)) / 2
  return Math.round(TICK_MIN + (TICK_MAX - TICK_MIN) * ease)
}
