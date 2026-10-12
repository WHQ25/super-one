import { CHAT_WINDOW, normalizeChatWindow, type ChatWindowRange } from './chat-window'

export function visibleChatWindow(range: ChatWindowRange, total: number, minimum = 0): ChatWindowRange {
  return normalizeChatWindow({ start: Math.max(minimum, range.start), end: Math.max(minimum + 1, range.end) }, total)
}

export function jumpChatWindow(index: number, total: number, minimum = 0): ChatWindowRange {
  const end = Math.min(total, index + CHAT_WINDOW.initialTurns - 4)
  return visibleChatWindow({ start: Math.max(0, end - CHAT_WINDOW.initialTurns), end }, total, minimum)
}

export interface ScrollAnchor { id: string; edge: 'top' | 'bottom'; offset: number }

/**
 * Preserve a visible DOM anchor even when paging drops rows at the opposite end.
 * `bottom` holds the anchor's lower edge instead: content prepended inside the
 * anchor row itself (an earlier part of a partial reply) pushes only that edge.
 */
export function captureScrollAnchor(edge: ScrollAnchor['edge'] = 'top'): ScrollAnchor | null {
  const elements = document.querySelectorAll<HTMLElement>('[data-turn-id]')
  for (const element of elements) {
    const box = element.getBoundingClientRect()
    if (box.bottom > 0) return { id: element.dataset.turnId!, edge, offset: box[edge] }
  }
  return null
}
