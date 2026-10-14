import type { ChatMessage, HarnessId } from './agent-types'
import { isSlashCommandBubble, parseTurnMetaMarker } from './transcript-markers'

/**
 * System row for a session recap (`__turn_meta__:{kind:recap}`). Shared so main
 * (persisted snapshot) and the live reducers (renderer, mobile) mint the same row.
 */
export function buildRecapMessage(id: string, createdAt: string, text: string, auto?: boolean): ChatMessage {
  const payload = { kind: 'recap', text, ...(auto !== undefined ? { auto } : {}) }
  return {
    id,
    role: 'assistant',
    status: 'complete',
    content: [{ type: 'text', text: `__turn_meta__:${JSON.stringify(payload)}` }],
    createdAt,
    providerId: 'system',
  }
}

/**
 * Append `row`, or `null` when the tail already shows that recap (replay).
 *
 * `replyId` names the turn of a sent `/recap`: its bubble and blank reply are the
 * command, not the conversation, so the row takes their place — the same
 * transcript Grok's host-side recap produces.
 */
export function withRecapRow(messages: readonly ChatMessage[], row: ChatMessage, replyId?: string): ChatMessage[] | null {
  const recap = parseTurnMetaMarker(row)
  const tail = messages.at(-1)
  const last = tail ? parseTurnMetaMarker(tail) : null
  if (recap?.kind === 'recap' && last?.kind === 'recap' && last.text === recap.text && last.auto === recap.auto) return null
  if (!replyId) return [...messages, row]
  const next = messages.filter((m) => m.id !== replyId)
  const bubbleIdx = next.findLastIndex((m) => m.role === 'user')
  if (bubbleIdx >= 0 && isSlashCommandBubble(next[bubbleIdx], 'recap')) next.splice(bubbleIdx, 1)
  next.push(row)
  return next
}

/**
 * While a sent `/recap` runs, hide its bubble and reply: the recapping line
 * stands for the turn, as it does for Grok's host-side recap.
 */
export function withoutPendingRecapTurn(messages: readonly ChatMessage[], isRecapping: boolean): readonly ChatMessage[] {
  if (!isRecapping) return messages
  const at = messages.findLastIndex((m) => m.role === 'user')
  return at >= 0 && isSlashCommandBubble(messages[at], 'recap') ? messages.slice(0, at) : messages
}

/** Harnesses whose `/recap` is a local command answering with the recap as stdout. */
const RECAP_SLASH_HARNESSES = new Set<HarnessId>(['claude'])

export function isRecapSlashSend(harnessId: HarnessId, content: string): boolean {
  return RECAP_SLASH_HARNESSES.has(harnessId) && content.trim() === '/recap'
}
