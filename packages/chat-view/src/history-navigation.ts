import type { ChatMessage } from '@superone/shared/agent-types'
import type { SessionHistoryIndex } from '@superone/shared/session-history-index'
import type { ChatWindowRange } from './chat-window'

/** Never render across an unloaded gap when moving through sparse cached pages. */
export function contiguousHistoryRange(messages: ChatMessage[], index: SessionHistoryIndex | null, range: ChatWindowRange, anchor: number): ChatWindowRange {
  if (!index || !messages.length) return range
  const positions = new Map(index.messageIds.map((id, position) => [id, position]))
  const adjacent = (a: number, b: number) => {
    const left = positions.get(messages[a]?.id), right = positions.get(messages[b]?.id)
    return left === undefined || right === undefined || right === left + 1
  }
  let start = Math.max(range.start, Math.min(anchor, messages.length - 1))
  let end = start + 1
  while (start > range.start && adjacent(start - 1, start)) start--
  while (end < range.end && adjacent(end - 1, end)) end++
  return { start, end }
}

export function needsHistoryPage(messages: ChatMessage[], index: SessionHistoryIndex, range: ChatWindowRange, direction: 'before' | 'after'): boolean {
  const local = direction === 'before' ? range.start : range.end - 1
  const global = index.messageIds.indexOf(messages[local]?.id)
  const adjacent = global + (direction === 'before' ? -1 : 1)
  return global >= 0 && adjacent >= 0 && adjacent < index.messageIds.length
    && messages[local + (direction === 'before' ? -1 : 1)]?.id !== index.messageIds[adjacent]
}

export function globalHistoryRange(messages: ChatMessage[], index: SessionHistoryIndex, range: ChatWindowRange): ChatWindowRange {
  return { start: Math.max(0, index.messageIds.indexOf(messages[range.start]?.id)),
    end: Math.max(0, index.messageIds.indexOf(messages[range.end - 1]?.id) + 1) }
}
