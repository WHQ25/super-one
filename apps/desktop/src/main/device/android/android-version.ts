/**
 * API level to the version number a person would say.
 *
 * Needed because the two sources disagree about which one they report. A running
 * device answers `ro.build.version.release` with "16", but an AVD that has never
 * booted only has `target=android-36.1` in its config — and "Android 36" is not a
 * thing, so showing it would make the catalog read like a bug.
 */

/**
 * From API 33 on, the marketing version is the API level minus 20, and that has held
 * for every release since. Extrapolating rather than tabulating means a level that
 * ships after this code was written still reads correctly instead of falling back to
 * a bare number.
 *
 * The floor is 33 rather than 30 because the offset is not constant across that
 * boundary: Android 12L took an API level (32) without taking a version number, so
 * everything below it is off by one — 30 is Android 11 and 31 is Android 12, both
 * minus 19. Assuming a single offset from 30 gets those two wrong and nothing else,
 * which is exactly the kind of error that survives a spot check on a modern device.
 */
const MODERN_OFFSET = 20
const MODERN_FLOOR = 33

/** Levels at or below the discontinuity. Here there is no rule, only history. */
const LEGACY: Record<number, string> = {
  32: '12L',
  31: '12',
  30: '11',
  29: '10',
  28: '9',
  27: '8.1',
  26: '8.0',
  25: '7.1',
  24: '7.0',
  23: '6.0',
  22: '5.1',
  21: '5.0',
}

/** "Android 16". Falls back to naming the level when there is nothing better to say. */
export function androidVersionName(apiLevel: number): string {
  if (!Number.isFinite(apiLevel) || apiLevel <= 0) return 'Android'
  if (apiLevel >= MODERN_FLOOR) return `Android ${apiLevel - MODERN_OFFSET}`
  const legacy = LEGACY[apiLevel]
  return legacy ? `Android ${legacy}` : `Android API ${apiLevel}`
}

/**
 * The API level out of an AVD's `target` or a system image path.
 *
 * Both spell it `android-36` or `android-36.1`, and the fractional part is an image
 * revision rather than a level — `android-36.1` is still API 36, so it is dropped
 * rather than rounded.
 */
export function parseApiLevel(target: string): number {
  const match = /android-(\d+)/.exec(target)
  return match ? Number.parseInt(match[1]!, 10) : 0
}
