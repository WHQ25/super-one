/**
 * Author-facing composer form types shared by the mini-app frontend, widgets and
 * the MiniApp Host (`context.composer`). Self-contained on purpose: the mini-app
 * scaffold prepends this file to the generated `superone.d.ts` and
 * `superone-host.d.ts`, so it must not import anything.
 */

/** Where a submitted answer goes. `caller` (the default): back to the opener. `agent`: to the session's agent as a user message. */
export type SuperOneComposerOutput = 'caller' | 'agent'

export type SuperOneComposerValue = string | number | boolean | string[]

/** A form shown in a session's composer. */
export interface SuperOneComposerSpec {
  title: string
  description?: string
  /**
   * Flat JSON Schema object, as in MCP elicitation `requestedSchema`: string,
   * number/integer, boolean, enum/oneOf choices and string arrays. No nesting.
   */
  requestedSchema: Record<string, unknown>
  submitLabel?: string
}

export interface SuperOneComposerOpenOptions {
  /** Defaults to `caller`. */
  output?: SuperOneComposerOutput
}

export type SuperOneComposerCancelReason = 'user' | 'aborted' | 'owner_disposed' | 'session_removed'

/** `values` only for `caller` output; an `agent` answer goes to the agent alone. */
export type SuperOneComposerOutcome =
  | { status: 'submitted'; values: Record<string, SuperOneComposerValue> }
  | { status: 'submitted' }
  | { status: 'cancelled'; reason: SuperOneComposerCancelReason }
