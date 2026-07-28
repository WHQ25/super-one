import type { AgentEvent, ContentBlock } from '@superone/shared/agent-types'

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

type ContentDeltaEvent = Extract<AgentEvent, { type: 'content_delta' }>
type CodexItemDeltaEvent = Extract<AgentEvent, { type: 'codex_item_delta' }>

/** Exact coalesce key — mismatch forces a new group. Returns null if not foldable. */
export function agentEventCoalesceKey(event: AgentEvent): string | null {
  if (event.type === 'content_delta') {
    const kind = event.delta.type
    // Only additive text/thinking are safe to concatenate within a window.
    if (kind !== 'text' && kind !== 'thinking') return null
    const parent =
      'parentToolUseId' in event.delta && event.delta.parentToolUseId != null
        ? String(event.delta.parentToolUseId)
        : ''
    return [
      'content_delta',
      event.projectPath ?? '',
      event.sessionId ?? '',
      event.messageId,
      parent,
      kind,
      event.epoch ?? '',
      event.isSynthetic ? '1' : '0',
      event.isReplay ? '1' : '0',
    ].join('\0')
  }
  if (event.type === 'codex_item_delta') {
    // Snapshot upsert by item id — fold keeps last payload, never concatenates.
    // codex_item_delta has no isSynthetic/isReplay on the shared event contract.
    return [
      'codex_item_delta',
      event.projectPath ?? '',
      event.sessionId ?? '',
      event.messageId,
      event.item.id,
      event.epoch ?? '',
    ].join('\0')
  }
  return null
}

function foldContentDelta(prev: ContentDeltaEvent, next: ContentDeltaEvent): ContentDeltaEvent | null {
  // Additive text/thinking must not collapse sequenced events: the store dedups
  // via isReplayedEventForMessage(seq <= lastApplied). Folding seq=1:"old" +
  // seq=2:"new" into seq=2:"oldnew" re-applies "old" when lastApplied is already 1,
  // and drops "new" if we kept the first seq instead.
  if (prev.seq !== undefined || next.seq !== undefined) return null

  const a = prev.delta
  const b = next.delta
  if (a.type === 'text' && b.type === 'text') {
    const merged: ContentBlock = {
      ...b,
      type: 'text',
      text: (a.text ?? '') + (b.text ?? ''),
    }
    return { ...next, delta: merged }
  }
  if (a.type === 'thinking' && b.type === 'thinking') {
    const merged: ContentBlock = {
      ...b,
      type: 'thinking',
      thinking: (a.thinking ?? '') + (b.thinking ?? ''),
      // First start, last end — progressive thinking clocks stay coherent.
      startedAt: a.startedAt ?? b.startedAt,
      endedAt: b.endedAt ?? a.endedAt,
    }
    return { ...next, delta: merged }
  }
  return null
}

/**
 * Fold consecutive same-key deltas in a flush window.
 * - content_delta text/thinking: concatenate additive fields
 * - codex_item_delta: keep last snapshot for the same item id
 * Non-foldable events (or key breaks) flush prior group then stand alone.
 */
export function coalesceAgentEventBatch(events: AgentEvent[]): AgentEvent[] {
  if (events.length <= 1) return events
  const out: AgentEvent[] = []
  let groupKey: string | null = null
  let groupAcc: AgentEvent | null = null

  const flushGroup = (): void => {
    if (groupAcc) out.push(groupAcc)
    groupKey = null
    groupAcc = null
  }

  for (const event of events) {
    const key = agentEventCoalesceKey(event)
    if (key == null) {
      flushGroup()
      out.push(event)
      continue
    }
    if (groupAcc == null || groupKey !== key) {
      flushGroup()
      groupKey = key
      groupAcc = event
      continue
    }
    if (event.type === 'content_delta' && groupAcc.type === 'content_delta') {
      const folded = foldContentDelta(groupAcc, event)
      if (folded) {
        groupAcc = folded
        continue
      }
      flushGroup()
      groupKey = key
      groupAcc = event
      continue
    }
    if (event.type === 'codex_item_delta' && groupAcc.type === 'codex_item_delta') {
      // Last snapshot wins; preserve final seq.
      groupAcc = { ...event, seq: event.seq ?? groupAcc.seq }
      continue
    }
    flushGroup()
    groupKey = key
    groupAcc = event
  }
  flushGroup()
  return out
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
    for (const event of coalesceAgentEventBatch(batch)) safeDispatch(event)
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
