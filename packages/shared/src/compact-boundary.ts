import type { AgentEvent, ChatMessage, HarnessId } from './agent-types'
import { captureTranscriptBoundary } from './transcript-boundary'

export type CompactBoundaryEvent = Extract<AgentEvent, { type: 'compact_boundary' }>

/**
 * System row that marks where the context was compacted. The renderer parses
 * the `__compact__:` text back into a divider; the history index keeps it
 * separate from content entries. Shared so main (persisted snapshot) and the live reducers
 * (renderer, mobile) all mint an identical row for one event.
 */
export function buildCompactBoundaryMessage(event: CompactBoundaryEvent, id: string, createdAt: string, source?: ChatMessage, messages: readonly ChatMessage[] = []): ChatMessage {
  return {
    id,
    role: 'assistant',
    status: 'complete',
    content: [{ type: 'text', text: `__compact__:${event.trigger}:${event.preTokens}:${event.postTokens ?? ''}:${event.durationMs ?? ''}` }],
    createdAt,
    providerId: 'system',
    ...(event.boundary || source ? { metadata: { transcriptBoundary: event.boundary ?? captureTranscriptBoundary(source!, messages) } } : {}),
  }
}

/**
 * Retain the existing persistence order around the provider-owned live message.
 * The boundary cursor projects its completed prefix above the divider and its
 * continuation below it, without changing the event-routing message ID.
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
