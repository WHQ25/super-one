/**
 * Shape detection for SuperOne `*_run` (Jev fast loop) tool results.
 *
 * A run returns a JSON envelope — status / runId / since_last / snapshot — and
 * the chat UI JSON.parse()s it to learn which run this block belongs to, so it
 * can show the actions the loop took. The envelope embeds the final snapshot's
 * element list, so it routinely exceeds the generic 4000-char ACP tool-result
 * cap; sliced, the parse fails, the runId is lost and the block degrades to one
 * line of raw JSON instead of the per-action rows.
 *
 * Both ACP result mappers (@superone/acp tool-result-map and desktop main
 * acp-event-map) must agree on what to keep whole, so the predicates live here.
 */

/** Matches browser_run / computer_run / device_run under any MCP prefix. */
export function isJevRunToolName(toolName: string | undefined): boolean {
  if (!toolName) return false
  return /(?:^|__)(?:browser|computer|device)_run$/.test(toolName)
}

/**
 * Completion-only ACP updates can arrive without a title or rawInput to derive
 * the tool name from, so recognise the envelope by shape too — the same fallback
 * the collab, session-archive and computer-use predicates already use.
 *
 * The shape has to be narrow, because matching opts a payload out of the size
 * cap. A `status` string beside an id is common; requiring the run's own
 * vocabulary — one of three terminal statuses, a runId, and the step history
 * the block renders — is what makes it specific to a run.
 */
export function looksLikeJevRunResult(obj: Record<string, unknown>): boolean {
  const status = obj.status
  if (status !== 'paused' && status !== 'done' && status !== 'aborted') return false
  if (typeof obj.runId !== 'string') return false
  return Array.isArray(obj.since_last) || typeof obj.steps === 'number'
}
