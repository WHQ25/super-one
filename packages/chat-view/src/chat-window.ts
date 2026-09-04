/** Fail-closed limits shared by the WebView renderer and its native host. */
export const CHAT_WINDOW = {
  initialTurns: 24,
  loadMoreTurns: 8,
  maxMountedTurns: 40,
  envelopeMs: 33,
  streamingThrottleMs: 33,
  rssBudgetMb: 250,
  frameP95Ms: 20,
} as const

export type ChatWindow = typeof CHAT_WINDOW

/** Half-open message range: start is inclusive, end is exclusive. */
export interface ChatWindowRange {
  start: number
  end: number
}

function finiteInteger(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.trunc(value) : fallback
}

export function initialChatWindow(total: number): ChatWindowRange {
  const end = Math.max(0, finiteInteger(total, 0))
  return { start: Math.max(0, end - CHAT_WINDOW.initialTurns), end }
}

/** Normalize host-supplied state while enforcing the mounted-turn ceiling. */
export function normalizeChatWindow(
  range: ChatWindowRange,
  total: number,
): ChatWindowRange {
  const safeTotal = Math.max(0, finiteInteger(total, 0))
  const end = Math.min(safeTotal, Math.max(0, finiteInteger(range.end, safeTotal)))
  const requestedStart = Math.min(end, Math.max(0, finiteInteger(range.start, end)))
  return {
    start: Math.max(requestedStart, end - CHAT_WINDOW.maxMountedTurns),
    end,
  }
}

export function loadPreviousChatWindow(
  range: ChatWindowRange,
  total: number,
): ChatWindowRange {
  const current = normalizeChatWindow(range, total)
  return normalizeChatWindow({
    start: current.start - CHAT_WINDOW.loadMoreTurns,
    end: current.end,
  }, total)
}
