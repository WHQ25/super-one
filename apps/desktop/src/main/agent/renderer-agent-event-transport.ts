import type { AgentEvent, CodexThreadItem } from '@superone/shared/agent-types'
import { AGENT_EVENT_BATCH_MS } from '@superone/shared/agent-event-batcher'
import { createEventBatcher } from '@superone/runtime/stream'

export interface RendererAgentEventTransport {
  push(event: AgentEvent): void
  flush(): void
  /** Forget the items sent so far (all, or one session's), so the next update is sent whole. */
  resetCodexBaselines(session?: { projectPath?: string; sessionId: string }): void
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

/** The shared start of every route key under `parts`. */
function routePrefix(...parts: string[]): string {
  return JSON.stringify(parts).slice(0, -1)
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

/** The `local-ui` profile: batch, then encode Codex items as patches. */
export function createRendererAgentEventTransport(
  send: (events: AgentEvent[]) => void,
  batchMs: number = AGENT_EVENT_BATCH_MS,
): RendererAgentEventTransport {
  const codexBaselines = new Map<string, CodexThreadItem>()
  let disposed = false
  const forget = (prefix: string) => {
    for (const key of codexBaselines.keys()) {
      if (key.startsWith(prefix)) codexBaselines.delete(key)
    }
  }

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
      forget(routePrefix(event.projectPath ?? '', event.sessionId ?? '', event.draftSessionId ?? '', event.messageId))
    }
    return event
  }

  const batcher = createEventBatcher((events) => send(events.map(encode)), { delayMs: batchMs })

  return {
    push(event) {
      if (!disposed) batcher.push(event)
    },
    flush: batcher.flush,
    resetCodexBaselines(session) {
      if (session) forget(routePrefix(session.projectPath ?? '', session.sessionId, ''))
      else codexBaselines.clear()
    },
    dispose() {
      if (disposed) return
      batcher.flush()
      disposed = true
      codexBaselines.clear()
    },
  }
}
