/**
 * Shape detection for SuperOne computer_* tool results.
 *
 * These payloads are a JSON envelope (stateId / root / truncation) whose
 * `outline` field carries a TOON table. The chat UI JSON.parse()s the envelope
 * to find the stateId and the target app's bundleId, and splits the outline out
 * to render it as a table. The generic 4000-char ACP tool-result cap slices it
 * mid-string, so the parse fails and the whole block degrades to one unreadable
 * line with no app icon.
 *
 * Both ACP result mappers (@superone/acp tool-result-map and desktop main
 * acp-event-map) must agree on what to keep whole, so the predicates live here.
 */

/** Matches computer_snapshot / computer_query / computer_act / … under any MCP prefix. */
export function isComputerUseToolName(toolName: string | undefined): boolean {
  if (!toolName) return false
  return /(?:^|__)computer_(?:snapshot|observe|query|act|apps|zoom|wait_for)$/.test(toolName)
}

/**
 * Completion-only ACP updates can arrive without a title or rawInput to derive
 * the tool name from, so recognise the envelope by shape too — same fallback
 * the collab and session-archive predicates already use.
 *
 * The shape has to be narrow, because matching means opting a payload out of the
 * generic size cap. A state id beside a root object is not enough on its own —
 * plenty of workflow results look like that. Requiring the root to carry both
 * the app name and its bundle id is what makes it specific: `UiRootIdentity`
 * always has both, and a generic state machine has neither.
 */
function isComputerUseRoot(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const root = value as Record<string, unknown>
  return typeof root.app === 'string' && typeof root.bundleId === 'string'
}

export function looksLikeComputerUseResult(obj: Record<string, unknown>): boolean {
  // computer_act reports the state it landed in under successor* names.
  const stateId = typeof obj.stateId === 'string' ? obj.stateId : obj.successorStateId
  if (typeof stateId !== 'string') return false
  return typeof obj.outline === 'string'
    || typeof obj.subtree === 'string'
    || typeof obj.element === 'string'
    || Array.isArray(obj.matches)
    || isComputerUseRoot(obj.root)
    || isComputerUseRoot(obj.successorRoot)
}

/** The outline table's header row, recognisable before the envelope is parsed. */
export function looksLikeComputerUseOutline(summary: string): boolean {
  return /outline\[\d+\]\{ref,depth/.test(summary)
}
