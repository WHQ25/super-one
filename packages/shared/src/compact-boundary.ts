import type { AgentEvent, ChatMessage, HarnessId } from './agent-types'

export type CompactBoundaryEvent = Extract<AgentEvent, { type: 'compact_boundary' }>

/**
 * System row that marks where the context was compacted. The renderer parses
 * the `__compact__:` text back into a divider; the history index reads it for
 * navigation. Shared so main (persisted snapshot) and the live reducers
 * (renderer, mobile) all mint an identical row for one event.
 */
export function buildCompactBoundaryMessage(event: CompactBoundaryEvent, id: string, createdAt: string): ChatMessage {
  return {
    id,
    role: 'assistant',
    status: 'complete',
    content: [{ type: 'text', text: `__compact__:${event.trigger}:${event.preTokens}:${event.postTokens ?? ''}:${event.durationMs ?? ''}` }],
    createdAt,
    providerId: 'system',
  }
}

/**
 * A boundary marks the exact point where the old context was compacted. Keep
 * only the live continuation below it; everything already completed belongs to
 * the compacted history. This also handles goal mode, where several assistant
 * turns can run after the most recent user message.
 */
export function compactBoundaryInsertIndex(messages: readonly ChatMessage[]): number {
  const liveIdx = messages.findLastIndex((m) => m.role === 'assistant' && m.status === 'streaming')
  return liveIdx !== -1 ? liveIdx : messages.length
}

/**
 * Harnesses whose `/compact` turn is pure command: the CLI compacts and replies
 * nothing, so the bubble and its blank reply are dropped once the boundary
 * lands. Codex answers with "Conversation compacted." and keeps its turn; ACP
 * compacts outside a turn.
 */
const COMPACT_SLASH_HARNESSES = new Set<HarnessId>(['claude', 'opencode', 'dsh'])

export function isCompactSlashSend(harnessId: HarnessId, content: string): boolean {
  return COMPACT_SLASH_HARNESSES.has(harnessId) && content.trim() === '/compact'
}
