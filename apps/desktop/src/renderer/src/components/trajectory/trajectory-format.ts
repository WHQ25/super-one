/** Display formatting for trajectory durations, token counts, and clocks. */

/**
 * Format a duration the way the ledger reads it: sub-second work in
 * milliseconds, longer work in seconds, and unknown timing as an em dash rather
 * than a fabricated zero.
 * @param ms - the duration, or `null` when it is not known.
 * @returns the display string.
 */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—'
  if (ms < 1_000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 2 : 1)}s`
  const minutes = Math.floor(ms / 60_000)
  return `${minutes}m ${Math.round((ms % 60_000) / 1_000)}s`
}

/**
 * Format a token count with thousands separators.
 * @param tokens - the count, or `null` when none was reported.
 * @returns the display string.
 */
export function formatTokens(tokens: number | null): string {
  if (tokens === null || !Number.isFinite(tokens)) return '—'
  return tokens.toLocaleString()
}

/**
 * Format a Unix epoch timestamp as a wall clock with milliseconds.
 * @param time - Unix epoch ms.
 * @returns the display string, to millisecond precision.
 */
export function formatClock(time: number): string {
  const date = new Date(time)
  const pad = (value: number, width = 2) => String(value).padStart(width, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

/**
 * Pretty-print a JSON payload for the inspector, leaving non-JSON text alone.
 *
 * Tool arguments arrive as the raw string the model produced, which is usually
 * but not always valid JSON — a truncated or malformed call is exactly the kind
 * of thing this panel exists to show, so it is displayed verbatim.
 * @param text - the raw payload.
 * @returns indented JSON when it parses, otherwise the original text.
 */
export function formatJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}
