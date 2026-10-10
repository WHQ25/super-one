import type { AgentEvent } from '@superone/shared/agent-types'
import { AGENT_EVENT_BATCH_MS, coalesceAgentEventBatch } from '@superone/shared/agent-event-batcher'

/**
 * The batch stage every subscriber profile ends with.
 *
 * Only streaming deltas wait (up to `delayMs`); any other event joins the
 * pending batch and flushes it at once, so completions, status changes and
 * interactions are never delayed behind text. A batch never mixes groups
 * (a recipient set): a new group flushes the pending batch first. Adjacent
 * additive deltas are folded on flush (`coalesceAgentEventBatch`).
 */
export interface EventBatcher<G> {
  push(event: AgentEvent, group?: G): void
  flush(): void
  /** Drops the pending batch; the batcher stays usable. */
  clear(): void
}

export interface EventBatcherOptions {
  delayMs?: number
  /** Flush once the pending batch reaches this many serialized bytes. */
  maxBytes?: number
  /** Flush before the batch would exceed this many events. */
  maxEvents?: number
}

function isDeferrable(event: AgentEvent): boolean {
  return event.type === 'content_delta' || event.type === 'codex_item_delta'
}

export function createEventBatcher<G = undefined>(
  send: (events: AgentEvent[], group: G | undefined) => void,
  options: EventBatcherOptions = {},
): EventBatcher<G> {
  const delayMs = options.delayMs ?? AGENT_EVENT_BATCH_MS
  const { maxBytes, maxEvents } = options
  const encoder = maxBytes === undefined ? null : new TextEncoder()
  let events: AgentEvent[] = []
  let group: G | undefined
  let groupKey = ''
  let bytes = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = (): void => {
    if (timer != null) clearTimeout(timer)
    timer = null
    const batch = events
    events = []
    bytes = 0
    if (batch.length) send(coalesceAgentEventBatch(batch), group)
  }

  return {
    push(event, nextGroup) {
      const key = nextGroup === undefined ? '' : JSON.stringify(nextGroup)
      const size = encoder ? encoder.encode(JSON.stringify(event)).length : 0
      if (events.length && (
        key !== groupKey
        || (maxBytes !== undefined && bytes + size > maxBytes)
        || (maxEvents !== undefined && events.length >= maxEvents)
      )) flush()
      groupKey = key
      group = nextGroup
      events.push(event)
      bytes += size
      if (!isDeferrable(event) || (maxBytes !== undefined && bytes >= maxBytes)) flush()
      else timer ??= setTimeout(flush, delayMs)
    },
    flush,
    clear() {
      if (timer != null) clearTimeout(timer)
      timer = null
      events = []
      bytes = 0
    },
  }
}
