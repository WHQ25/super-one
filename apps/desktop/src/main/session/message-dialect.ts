import type { HarnessId } from './types'

/**
 * How a harness phrases its transcript, and therefore which main-process
 * reducer materializes `Session._messages` — the only source of truth for what
 * gets persisted. The renderer keeps its own unified reducer for live display,
 * so a mismatch here is invisible until the session is reopened cold.
 *
 * - `claude`: `message_start` → `content_delta`* → `message_complete`.
 * - `codex`: `codex_item_delta` + a terminal `metadata.codex` payload.
 */
export type MessageDialect = 'claude' | 'codex'

/**
 * Exhaustive by construction: `Record<HarnessId, …>` means a new harness fails
 * to compile until it declares its dialect. This replaced a defaulting `else`
 * that silently routed every unlisted harness through the Codex reducer, which
 * drops `content_delta` and then overwrites the message with empty text — dsh
 * transcripts rendered live and came back user-only after a restart.
 */
export const MESSAGE_DIALECT_BY_HARNESS: Record<HarnessId, MessageDialect> = {
  claude: 'claude',
  acp: 'claude',
  cursor: 'claude',
  opencode: 'claude',
  dsh: 'claude',
  codex: 'codex',
}

export function messageDialectFor(harnessId: HarnessId): MessageDialect {
  return MESSAGE_DIALECT_BY_HARNESS[harnessId]
}
