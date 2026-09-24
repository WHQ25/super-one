import type { ChatMessage } from '@superone/shared/agent-types'
import { historyPositions, type SessionHistoryIndex } from '@superone/shared/session-history-index'
import { CHAT_WINDOW, normalizeChatWindow, type ChatWindowRange } from './chat-window'
import { parseCompactMarker } from './presenters/ChatMessageIndicators'

export function compactMessageIndices(messages: readonly ChatMessage[]): number[] {
  return messages.flatMap((message, index) => parseCompactMarker(message) ? [index] : [])
}

/**
 * Compact markers on the session timeline. With a history index, positions and
 * markers are global, so an unloaded compact still collapses the history above it.
 */
export interface CompactTimeline {
  ids: string[]
  position: (id: string) => number
}

export function compactTimeline(messages: readonly ChatMessage[], index: SessionHistoryIndex | null): CompactTimeline {
  const positions = historyPositions(index, messages)
  const ids = [...new Set([...index?.compacts.map(compact => compact.id) ?? [],
    ...compactMessageIndices(messages).map(position => messages[position]!.id)])]
  return { ids: ids.sort((a, b) => positions.get(a)! - positions.get(b)!), position: id => positions.get(id) ?? -1 }
}

/** Same expansion levels as desktop: zero hides everything before the latest compact. */
export function compactBoundary(timeline: CompactTimeline, expandLevel: number): string | undefined {
  return timeline.ids[timeline.ids.length - 1 - Math.max(0, expandLevel)]
}

/** First loaded row at or below the collapse boundary. */
export function compactVisibleStart(messages: readonly ChatMessage[], timeline: CompactTimeline, expandLevel: number): number {
  const boundary = compactBoundary(timeline, expandLevel)
  if (boundary === undefined) return 0
  const from = timeline.position(boundary)
  const start = messages.findIndex(message => timeline.position(message.id) >= from)
  return start < 0 ? messages.length : start
}

/** Expansion level that reveals `id`. */
export function compactsAfter(timeline: CompactTimeline, id: string): number {
  const at = timeline.position(id)
  return timeline.ids.filter(compact => timeline.position(compact) > at).length
}

export function visibleChatWindow(range: ChatWindowRange, total: number, minimum: number): ChatWindowRange {
  return normalizeChatWindow({ start: Math.max(minimum, range.start), end: Math.max(minimum + 1, range.end) }, total)
}

export function jumpChatWindow(index: number, total: number, minimum = 0): ChatWindowRange {
  const end = Math.min(total, index + CHAT_WINDOW.initialTurns - 4)
  return visibleChatWindow({ start: Math.max(0, end - CHAT_WINDOW.initialTurns), end }, total, minimum)
}

export interface ScrollAnchor { id: string; top: number }

/** Preserve a visible DOM anchor even when paging drops rows at the opposite end. */
export function captureScrollAnchor(): ScrollAnchor | null {
  const elements = document.querySelectorAll<HTMLElement>('[data-turn-id]')
  for (const element of elements) {
    const box = element.getBoundingClientRect()
    if (box.bottom > 0) return { id: element.dataset.turnId!, top: box.top }
  }
  return null
}
