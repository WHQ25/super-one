import type { AgentEvent, ContentBlock } from './agent-types'

export const AGENT_EVENT_BATCH_MS = 33

export interface AgentEventBatcher {
  push(event: AgentEvent): void
  flush(): void
  dispose(): void
}

type ContentDeltaEvent = Extract<AgentEvent, { type: 'content_delta' }>

export function agentEventCoalesceKey(event: AgentEvent): string | null {
  if (event.type === 'content_delta') {
    const kind = event.delta.type
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
  // Sequenced deltas must remain separate so replay deduplication can advance
  // one sequence number at a time.
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
      startedAt: a.startedAt ?? b.startedAt,
      endedAt: b.endedAt ?? a.endedAt,
    }
    return { ...next, delta: merged }
  }
  return null
}

/** Fold only consecutive, safely additive events while preserving arrival order. */
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
      flush()
      safeDispatch(event)
    },
    flush,
    dispose: flush,
  }
}
