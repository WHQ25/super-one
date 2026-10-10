import type { SessionLoadRequest } from './session-messages'
import type { ChatMessage } from '../agent-types'

/** Completed active-turn rows may still be absent from persisted history. */
export function activeTurnMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  let start = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') { start = i; break }
  }
  const streaming = messages.findIndex(message => message.status === 'streaming')
  if (streaming >= 0) start = Math.min(start, streaming)
  return messages.slice(start)
}

export function activeTurnOutsidePage(messages: readonly ChatMessage[], range: { start: number; end: number }): ChatMessage[] {
  const pageIds = new Set(messages.slice(range.start, range.end).map(message => message.id))
  return activeTurnMessages(messages).filter(message => !pageIds.has(message.id))
}

/** Chronological bounds shared by desktop transcripts and the node read model. */
export function sessionMessageRange(messages: readonly { id: string }[], page: Omit<SessionLoadRequest, 'sessionId'> = {}) {
  if (page.before != null && (!Number.isSafeInteger(page.before) || page.before < 0)) throw invalid('before must be a non-negative integer')
  if (page.limit !== undefined && (!Number.isSafeInteger(page.limit) || page.limit < 1)) throw invalid('limit must be a positive integer')
  if (page.direction !== undefined && !['around', 'before', 'after'].includes(page.direction)) throw invalid('direction must be around|before|after')
  if (page.direction !== undefined && !page.anchorId) throw invalid('direction requires anchorId')
  if (page.anchorId !== undefined && (!page.anchorId.trim() || page.before != null)) throw invalid('anchorId must be non-empty and cannot be combined with before')
  const size = Math.min(page.limit ?? 50, 200)
  if (page.anchorId !== undefined) {
    const anchor = messages.findIndex(message => message.id === page.anchorId)
    if (anchor < 0) throw Object.assign(new Error('History message no longer exists'), { code: 'not_found' })
    const direction = page.direction ?? 'around'
    const start = direction === 'after' ? anchor + 1 : direction === 'before' ? Math.max(0, anchor - size) : Math.max(0, anchor - Math.min(2, size - 1))
    return { start, end: direction === 'before' ? anchor : Math.min(messages.length, start + size) }
  }
  const end = Math.min(page.before ?? messages.length, messages.length)
  return { start: Math.max(0, end - size), end }
}

function invalid(message: string): Error { return Object.assign(new Error(message), { code: 'invalid_argument' }) }
