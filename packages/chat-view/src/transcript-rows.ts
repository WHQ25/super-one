import { isCodexAsyncAnswer } from '@superone/shared/codex-async-question'
import type { ChatMessage } from '@superone/shared/agent-types'
import {
  isRedundantTurnSummaryMarker,
  parseCompactMarker,
  parseTurnMetaMarker,
  type TurnMetaMarker,
} from './presenters/ChatMessageIndicators'

export type TranscriptRow =
  | { kind: 'turn'; message: ChatMessage }
  | { kind: 'compact'; message: ChatMessage; marker: NonNullable<ReturnType<typeof parseCompactMarker>> }
  | { kind: 'turn-meta'; message: ChatMessage; meta: TurnMetaMarker }
  /** A summary marker whose text the turn footer already shows. */
  | { kind: 'hidden'; message: ChatMessage }

/**
 * What a transcript row actually is.
 *
 * Compaction and turn-meta markers are persisted as ordinary assistant messages
 * carrying an encoded marker in their first text block. Rendering one as a turn
 * prints the raw `__compact__:` / `__turn_meta__:` string into the transcript,
 * which is what the phone used to do.
 *
 * `all` is the full transcript rather than the mounted range: the redundancy
 * check asks whether some assistant turn already carries the same summary, and
 * that turn can sit outside the mounted range entirely.
 */
export function transcriptRow(message: ChatMessage, all: readonly ChatMessage[]): TranscriptRow {
  if (isCodexAsyncAnswer(message)) return { kind: 'hidden', message }
  const marker = parseCompactMarker(message)
  if (marker) return { kind: 'compact', message, marker }
  const meta = parseTurnMetaMarker(message)
  if (meta) {
    return isRedundantTurnSummaryMarker(meta, all)
      ? { kind: 'hidden', message }
      : { kind: 'turn-meta', message, meta }
  }
  return { kind: 'turn', message }
}
