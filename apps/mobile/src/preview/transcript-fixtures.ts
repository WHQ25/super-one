import type { ChatMessage } from '@superone/shared/agent-types'
import { extendHistoryIndex } from '@superone/shared/session-history-index'
import type { ReductionProjection } from '@superone/chat-view'

/**
 * Every transient state the chat document can be in, selectable from the
 * preview's Chat page. The transcript itself is a fixture; what each state
 * changes is the *session projection* around it (pending turn, retry banner,
 * compaction) or how the preview answers the document's history requests.
 *
 * `restoring` is the one native state here: it holds `ChatScreen`'s
 * session-switch cover over the WebView, which nothing inside the document
 * can produce.
 */
export const transcriptStates = [
  'live', 'restoring', 'history', 'history-slow', 'history-failed', 'index-loading', 'index-failed',
  'creating', 'sending', 'api-retry', 'compacting', 'compact-error', 'recapping',
] as const
export type TranscriptState = typeof transcriptStates[number]

const HISTORY_LENGTH = 60
const HISTORY_PAGE = 8
/** Long enough to read the state on screen; a real relay page lands in well under a second. */
const SLOW_MS = 2_500

/** A long conversation, so the latest page has plenty of history behind it. */
export const historyRows: ChatMessage[] = Array.from({ length: HISTORY_LENGTH }, (_, index) => ({
  id: `history-${index}`, role: index % 2 ? 'assistant' : 'user', providerId: 'claude', status: 'complete', createdAt: '',
  content: [{ type: 'text', text: index % 2
    ? `Reply ${(index + 1) / 2}\n\n${'Conversation content that runs long enough to scroll. '.repeat(6)}`
    : `Question ${index / 2 + 1}: what does the phone show while this page is still on its way?` }],
}))
const historyIndex = extendHistoryIndex({ messageIds: [], entries: [], compacts: [] }, historyRows)

const usesHistory = (state: TranscriptState) =>
  state === 'history' || state === 'history-slow' || state === 'history-failed' || state === 'index-loading' || state === 'index-failed'

/** The `hydrate` payload for a state: fixture rows plus the session facts that paint it. */
export function transcriptProjection(state: TranscriptState, live: ChatMessage[]): ReductionProjection {
  if (usesHistory(state)) return { historyNavigation: true, hasMoreHistory: true, messages: historyRows.slice(-HISTORY_PAGE) }
  const session: ReductionProjection = { historyNavigation: false, hasMoreHistory: false, messages: live, pendingTurn: null,
    apiRetry: null, isCompacting: false, compactError: null, isRecapping: false, sessionStatus: 'idle' }
  switch (state) {
    case 'creating': return { ...session, pendingTurn: 'creating' }
    case 'sending': return { ...session, pendingTurn: 'sending' }
    case 'api-retry': return { ...session, sessionStatus: 'streaming',
      apiRetry: { attempt: 2, maxRetries: 5, delayMs: 8_000, phase: 'retrying', message: '529 overloaded_error' } }
    case 'compacting': return { ...session, sessionStatus: 'streaming', isCompacting: true, compactingStartedAt: Date.now() - 4_000 }
    case 'compact-error': return { ...session, compactError: 'Context compaction failed: the model returned an empty summary.' }
    case 'recapping': return { ...session, sessionStatus: 'streaming', isRecapping: true }
    default: return session
  }
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Answers the document's `requestNative` history calls the way the shell's
 * `native-actions` would, held or failed per state. Resolves to the `result`
 * to send back; rejects with the `error` string.
 */
export async function answerTranscriptRequest(state: TranscriptState, action: string, payload: unknown): Promise<unknown> {
  if (action === 'loadNavigationIndex') {
    if (state === 'index-loading') return new Promise(() => {})
    if (state === 'index-failed') { await wait(600); throw new Error('Could not read the session index') }
    return historyIndex
  }
  if (action === 'loadHistoryWindow') {
    const { anchorId, direction } = payload as { anchorId: string; direction: 'around' | 'before' | 'after' }
    if (state === 'history-slow') await wait(SLOW_MS)
    if (state === 'history-failed') { await wait(600); throw new Error('Temporary history failure') }
    const position = historyRows.findIndex((row) => row.id === anchorId)
    const start = direction === 'before' ? Math.max(0, position - HISTORY_PAGE)
      : direction === 'after' ? position + 1 : Math.max(0, position - 2)
    const end = direction === 'before' ? position : Math.min(HISTORY_LENGTH, start + HISTORY_PAGE)
    return { messages: historyRows.slice(start, end) }
  }
  throw new Error(`preview cannot answer ${action}`)
}
