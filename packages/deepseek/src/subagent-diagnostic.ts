/** Bounds local subagent turn failures before they reach Task cards. */

/**
 * Match the upstream diagnostic budget for local turn failures so a long
 * error chain cannot push an unbounded string into each Task-card render.
 */
export const SUBAGENT_DIAGNOSTIC_MAX_BYTES = 4096

/**
 * Cut a string to at most `maxBytes` UTF-8 bytes without splitting a character.
 *
 * `TextEncoder`/`TextDecoder` do the work: encoding gives the true byte length,
 * and decoding a truncated buffer with `fatal: false` replaces a partial
 * trailing sequence, which is then dropped. Slicing by `.length` would count
 * UTF-16 units and cut emoji and CJK text mid-character.
 * @param value - the text to bound.
 * @param maxBytes - the inclusive byte budget.
 * @returns `value` unchanged when it already fits, else a shortened copy.
 */
export function truncateUtf8(value: string, maxBytes: number): string {
  const encoded = new TextEncoder().encode(value)
  if (encoded.byteLength <= maxBytes) return value
  const decoded = new TextDecoder('utf-8').decode(encoded.subarray(0, maxBytes))
  // A replacement char here is the tail of a sequence the cut split; dropping it
  // is what keeps the result valid text rather than ending in U+FFFD.
  return decoded.endsWith('�') ? decoded.slice(0, -1) : decoded
}
