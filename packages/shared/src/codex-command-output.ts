/** Cap on one Codex command item's accumulated stdout/stderr. */
export const MAX_AGGREGATED_OUTPUT_CHARS = 256 * 1024

const TRUNCATION_NOTICE = `\n… [output truncated at ${MAX_AGGREGATED_OUTPUT_CHARS} characters]`

/**
 * Codex re-emits a command item in full on every output delta, so an unbounded
 * `aggregatedOutput` costs O(total²) to stream and lands whole inside the
 * persisted message metadata — one `rg` over a large tree is enough to stall the
 * main process. Growth stops at the cap, keeping the head rather than a trailing
 * window: the renderer transport derives deltas with `startsWith`, so every
 * retained value has to stay a prefix of the ones after it.
 */
export function capAggregatedOutput(value: string): string {
  return value.length <= MAX_AGGREGATED_OUTPUT_CHARS
    ? value
    : `${value.slice(0, MAX_AGGREGATED_OUTPUT_CHARS)}${TRUNCATION_NOTICE}`
}

/** Append one output delta, stopping once the item has reached the cap. */
export function appendAggregatedOutput(previous: string | undefined, delta: string): string {
  const base = previous ?? ''
  // Only a capped value exceeds the cap, and a capped value is already final —
  // short-circuiting here keeps a long-running command's per-delta cost flat.
  if (base.length > MAX_AGGREGATED_OUTPUT_CHARS) return base
  return capAggregatedOutput(`${base}${delta}`)
}
