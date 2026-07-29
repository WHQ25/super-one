import type { AgentEvent, CodexThreadItem } from '@superone/shared/agent-types'
import {
  AGENT_EVENT_BATCH_MS,
  coalesceAgentEventBatch,
} from '@superone/shared/agent-event-batcher'

export interface RendererAgentEventTransport {
  push(event: AgentEvent): void
  flush(): void
  resetCodexBaselines(): void
  dispose(): void
}

function routeKey(event: AgentEvent, messageId: string, itemId: string): string {
  return JSON.stringify([
    event.projectPath ?? '',
    event.sessionId ?? '',
    event.draftSessionId ?? '',
    messageId,
    itemId,
  ])
}

function isTextItem(item: CodexThreadItem): item is Extract<CodexThreadItem, {
  type: 'agent_message' | 'reasoning' | 'plan' | 'review'
}> {
  return item.type === 'agent_message'
    || item.type === 'reasoning'
    || item.type === 'plan'
    || item.type === 'review'
}

function makeCodexPatch(
  previous: CodexThreadItem,
  current: CodexThreadItem,
): Extract<AgentEvent, { type: 'codex_item_patch' }>['patch'] | null {
  if (previous.type !== current.type) return null

  if (isTextItem(previous) && isTextItem(current)) {
    if (!current.text.startsWith(previous.text)) return null
    if (current.type === 'review' && previous.type === 'review' && current.phase !== previous.phase) return null
    const textDelta = current.text.slice(previous.text.length)
    if (current.type === 'reasoning') {
      return {
        type: 'reasoning',
        textDelta,
        startedAt: current.startedAt,
        endedAt: current.endedAt,
      }
    }
    return { type: current.type, textDelta }
  }

  if (previous.type === 'command_execution' && current.type === 'command_execution') {
    const stableFieldsMatch = previous.command === current.command
      && previous.status === current.status
      && previous.exitCode === current.exitCode
      && JSON.stringify(previous.commandActions) === JSON.stringify(current.commandActions)
    if (!stableFieldsMatch || !current.aggregatedOutput.startsWith(previous.aggregatedOutput)) return null
    return {
      type: 'command_execution',
      aggregatedOutputDelta: current.aggregatedOutput.slice(previous.aggregatedOutput.length),
    }
  }

  return null
}

export function createRendererAgentEventTransport(
  send: (events: AgentEvent[]) => void,
  batchMs: number = AGENT_EVENT_BATCH_MS,
): RendererAgentEventTransport {
  const queue: AgentEvent[] = []
  const codexBaselines = new Map<string, CodexThreadItem>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const encode = (event: AgentEvent): AgentEvent => {
    if (event.type === 'codex_item_delta') {
      const key = routeKey(event, event.messageId, event.item.id)
      const previous = codexBaselines.get(key)
      const patch = event.phase === 'updated' && previous
        ? makeCodexPatch(previous, event.item)
        : null

      if (event.phase === 'completed') codexBaselines.delete(key)
      else codexBaselines.set(key, event.item)

      if (patch) {
        const { item: _item, type: _type, ...routing } = event
        return {
          ...routing,
          type: 'codex_item_patch',
          phase: 'updated',
          itemId: event.item.id,
          patch,
        }
      }
      return event
    }

    if (
      event.type === 'message_complete'
      || event.type === 'message_interrupted'
      || event.type === 'message_error'
    ) {
      const prefix = JSON.stringify([
        event.projectPath ?? '',
        event.sessionId ?? '',
        event.draftSessionId ?? '',
        event.messageId,
      ]).slice(0, -1)
      for (const key of codexBaselines.keys()) {
        if (key.startsWith(prefix)) codexBaselines.delete(key)
      }
    }
    return event
  }

  const flush = (): void => {
    if (timer != null) {
      clearTimeout(timer)
      timer = null
    }
    if (queue.length === 0) return
    const events = coalesceAgentEventBatch(queue.splice(0, queue.length)).map(encode)
    if (events.length > 0) send(events)
  }

  const flushWith = (event: AgentEvent): void => {
    if (timer != null) {
      clearTimeout(timer)
      timer = null
    }
    const pending = queue.length > 0
      ? coalesceAgentEventBatch(queue.splice(0, queue.length))
      : []
    send([...pending, event].map(encode))
  }

  return {
    push(event) {
      if (disposed) return
      if (event.type === 'content_delta' || event.type === 'codex_item_delta') {
        queue.push(event)
        if (timer == null) timer = setTimeout(flush, batchMs)
        return
      }
      flushWith(event)
    },
    flush,
    resetCodexBaselines() {
      codexBaselines.clear()
    },
    dispose() {
      if (disposed) return
      flush()
      disposed = true
      codexBaselines.clear()
    },
  }
}
