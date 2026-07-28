import type { AgentEvent } from '@superone/shared/agent-types'

/**
 * Streaming text arrives as one `content_delta` (Claude/ACP) or
 * `codex_item_delta` (Codex) per update, and each one crosses IPC as its own
 * macrotask — so each becomes its own store write and its own React render.
 * Coalescing a window's worth into a single callback lets React's automatic
 * batching collapse them into one render.
 *
 * `setTimeout`, not `requestAnimationFrame`: under render pressure rAF starves
 * on paint and the stream visibly freezes.
 */
export const AGENT_EVENT_BATCH_MS = 33

export interface AgentEventBatcher {
  /** Queue a streamed delta, or dispatch anything else immediately. */
  push(event: AgentEvent): void
  /** Drain the queue now, preserving arrival order. */
  flush(): void
  /** Drain and stop — safe to call from an effect cleanup. */
  dispose(): void
}

export function createAgentEventBatcher(
  dispatch: (event: AgentEvent) => void,
  batchMs: number = AGENT_EVENT_BATCH_MS,
): AgentEventBatcher {
  const queue: AgentEvent[] = []
  let timer: ReturnType<typeof setTimeout> | null = null

  // One bad event must not tear down the IPC callback or strand the rest of a
  // batch — the store is shared across every session.
  const safeDispatch = (event: AgentEvent): void => {
    try {
      dispatch(event)
    } catch (err) {
      console.warn('[agent-event-batcher] dispatch error:', err)
    }
  }

  const flush = (): void => {
    if (timer != null) {
      clearTimeout(timer)
      timer = null
    }
    if (queue.length === 0) return
    // Splice first: a throwing dispatch must not replay the whole batch.
    const batch = queue.splice(0, queue.length)
    for (const event of batch) safeDispatch(event)
  }

  return {
    push(event) {
      if (event.type === 'content_delta' || event.type === 'codex_item_delta') {
        queue.push(event)
        if (timer == null) timer = setTimeout(flush, batchMs)
        return
      }
      // Everything else — permissions, questions, lifecycle — is low frequency
      // and often interactive, so it goes through untouched. Draining the queue
      // first keeps the delta/lifecycle ordering the reducers rely on.
      flush()
      safeDispatch(event)
    },
    flush,
    dispose() {
      flush()
    },
  }
}
