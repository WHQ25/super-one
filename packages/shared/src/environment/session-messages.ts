/**
 * Node session message catalog RPC contracts.
 *
 * Beyond the simplified durable transcript `{ id, role, text, createdAt }`,
 * `session.messages.list` returns denser blocks (tool use/result summaries,
 * optional metadata / checkpoint / resume ids) for remote UI hydrate.
 * Live catch-up still uses `session.events` with `afterSequence`.
 */

/** Tool use + result summary attached to an assistant message block. */
export interface SessionMessageToolSummary {
  toolUseId: string
  toolName: string
  /** Truncated / stringified tool input when available. */
  inputSummary?: string
  /** Truncated tool output / result summary when available. */
  outputSummary?: string
  isError?: boolean
  parentToolUseId?: string | null
}

/**
 * Denser message row for catalog hydrate.
 * Text still comes from the durable transcript; tools/metadata are expanded
 * from the session event log when present.
 */
export interface SessionMessageBlock {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  /** Unix ms (same clock as transcript / event log). */
  createdAt: number
  /** Chronological index in the full catalog (0-based). */
  sortOrder: number
  tools?: SessionMessageToolSummary[]
  metadata?: Record<string, unknown>
  checkpointId?: string
  resumePointId?: string
}

export interface SessionMessagesListRequest {
  sessionId: string
  /**
   * Exclusive end index for the page (desktop loadSessionMessages parity).
   * Omit / null = end of catalog (newest page). Decimal string or number.
   */
  cursor?: string | number | null
  /** Max messages per page (default 50, hard cap 200). */
  limit?: number
}

export interface SessionMessagesListResult {
  sessionId: string
  messages: SessionMessageBlock[]
  /**
   * Cursor for the next older page (exclusive end index of that page).
   * Null when there are no older messages.
   */
  cursor: string | null
  hasMore: boolean
}
