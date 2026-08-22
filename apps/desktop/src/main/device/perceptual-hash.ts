/**
 * Comparing the framebuffer fingerprints the helper produces.
 *
 * A perceptual hash is not an identity: two captures of a screen nobody would call
 * different can still differ in a bit or two, because the scaler lands a boundary on
 * the other side of a cell. So these are compared by distance, never by equality —
 * `===` on a perceptual hash reintroduces exactly the never-settles behaviour the
 * hash was chosen to avoid.
 */

/**
 * How many of the 64 bits may differ before two captures are called different.
 *
 * One, measured rather than guessed. A still simulator screen sampled seventeen
 * times in a row produced a bit-identical hash every time -- there is no camera and
 * no encoder here, so the render path is deterministic and there is no capture noise
 * to absorb. The single bit of slack is for a boundary landing on the other side of
 * a cell, not for motion.
 *
 * Anything larger actively misleads: an iOS bounce-back animation was measured
 * moving roughly three bits per 150ms sample, so a tolerance of three reported a
 * screen as still while it was visibly still moving. Erring generous here does not
 * cost a slow settle, it costs a wrong answer.
 */
export const FRAME_HASH_TOLERANCE = 1

export function frameHashDistance(a: string, b: string): number {
  if (a === b) return 0
  let left: bigint
  let right: bigint
  try {
    left = BigInt(`0x${a}`)
    right = BigInt(`0x${b}`)
  } catch {
    // A malformed hash is treated as maximally different rather than as a match:
    // claiming two screens are the same on the strength of a value we could not read
    // is the one wrong answer here.
    return 64
  }
  let diff = left ^ right
  let count = 0
  while (diff) {
    count += Number(diff & 1n)
    diff >>= 1n
  }
  return count
}

/** Whether two captures show the same picture, within the tolerance above. */
export function frameHashesMatch(
  a: string | undefined,
  b: string | undefined,
  tolerance = FRAME_HASH_TOLERANCE,
): boolean {
  // An absent hash is not evidence of sameness. Saying "unchanged" here would make a
  // device whose framebuffer could not be read look like a device that did nothing.
  if (!a || !b) return false
  return frameHashDistance(a, b) <= tolerance
}
