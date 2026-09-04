import type { AgentEvent } from '@superone/shared/agent-types'
import type { ChatCoreSession } from './types'

/**
 * Last-resort reconciliation for a session that sits at `idle` while its
 * backend is still streaming.
 *
 * Every known cause of that desync has been fixed at the source, but the class
 * of bug keeps recurring because `status` is a single event away from being
 * wrong and nothing else re-checks it: a turn-boundary `message_complete`
 * settles the status, and any harness that forgets to re-arm `streaming` for
 * the turn that follows strands the user with no Stop button while output keeps
 * arriving.
 *
 * The whitelist is deliberately tiny, because a false positive is worse than a
 * missed revive: it shows a Stop button that main will refuse to act on, since
 * `Session.interrupt()` answers to the real stream and not to this heuristic.
 * Only two signals qualify, and both mean "a turn is producing output right
 * now" rather than "a turn exists somewhere":
 *
 * - An assistant `message_start`. Never replayed — `Session.getReplayEvents()`
 *   returns only init/settings/catalog rows, and hydration writes messages
 *   directly instead of dispatching events.
 * - A message-scoped delta whose own message is still `streaming`, which a
 *   finished turn cannot produce.
 *
 * Pending interactions are NOT in that list even though a live turn is the only
 * thing that can *raise* one: `syncLiveSnapshots` re-delivers
 * `entry.pendingInteractions` through this same reducer right after writing
 * `status: 'idle'` from the main-process snapshot, so treating them as proof of
 * life would invent liveness that main explicitly denied. Neither is
 * `queued_message_consumed`, which needs no special case — every harness emits
 * the queued turn's `message_start` alongside it.
 */

/** Events that only prove life when their target message is still streaming. */
const MESSAGE_SCOPED_EVENTS = new Set<AgentEvent['type']>([
  'content_delta',
  'tool_input_delta',
  'tool_progress',
  'codex_item_delta',
  'codex_item_patch',
  'stream_message_start',
])

export function shouldReviveStreaming(session: ChatCoreSession, event: AgentEvent): boolean {
  if (session.status !== 'idle') return false

  if (event.type === 'message_start') {
    // System rows arrive as `user_message_appended`, so an assistant
    // `message_start` is always a real turn opening.
    return event.message.role === 'assistant'
  }
  if (!MESSAGE_SCOPED_EVENTS.has(event.type)) return false
  if ('isReplay' in event && event.isReplay) return false

  const { messageId } = event as { messageId?: string }
  if (!messageId) return false
  return session.messages.find((m) => m.id === messageId)?.status === 'streaming'
}
