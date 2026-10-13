import type { OpenCodeV2Event, OpenCodeV2Message } from './opencode-v2-types'

/** Read-only projected facts for servers whose durable log omits old records. */
export function openCodeProjectionEvents(sessionID: string, messages: OpenCodeV2Message[]): OpenCodeV2Event[] {
  const events: OpenCodeV2Event[] = []
  let compactionIndex = 0
  const emit = (type: string, data: Record<string, unknown>, created?: number, contentIndex?: number, compactionIndex?: number) => events.push({
    id: `projection-${events.length}`, type, data: { sessionID, ...data }, created, projected: true, contentIndex, compactionIndex,
  } as OpenCodeV2Event)
  for (const message of messages) {
    if (message.type === 'user') {
      emit('session.inbox.enqueued', { inboxID: message.id, item: { type: 'user', delivery: 'steer', payload: { text: message.text, metadata: message.metadata } } })
      emit('session.execution.started', {})
      emit('session.inbox.delivered', { inboxID: message.id })
    } else if (message.type === 'assistant') {
      const assistantMessageID = message.id
      emit('session.step.started', { assistantMessageID, agent: message.agent, model: message.model }, message.time.created)
      let textOrdinal = 0, reasoningOrdinal = 0
      for (const [contentIndex, block] of message.content.entries()) {
        if (block.type === 'text' || block.type === 'reasoning') {
          const ordinal = block.type === 'text' ? textOrdinal++ : reasoningOrdinal++
          emit(`session.${block.type}.started`, { assistantMessageID, ordinal }, block.type === 'reasoning' ? block.time?.created : message.time.created, contentIndex)
          emit(`session.${block.type}.ended`, { assistantMessageID, ordinal, text: block.text }, block.type === 'reasoning' ? block.time?.completed : message.time.completed, contentIndex)
        } else {
          const data = { assistantMessageID, id: block.id }
          emit('session.tool.input.started', { ...data, name: block.name }, block.time.created)
          if (block.state.status !== 'streaming') emit('session.tool.called', { ...data, input: block.state.input })
          if (block.state.status === 'completed') emit('session.tool.success', { ...data, content: block.state.content })
          if (block.state.status === 'error') emit('session.tool.failed', { ...data, error: block.state.error, content: block.state.content })
        }
      }
      if (message.tokens && message.cost !== undefined && message.time.completed) emit('session.step.ended', {
        assistantMessageID, tokens: message.tokens, cost: message.cost, finish: message.finish ?? 'unknown',
      })
    } else if (message.type === 'shell') {
      const shell = { id: message.shellID, command: message.command, status: message.status }
      emit('session.shell.started', { shell }, message.time.created)
      if (message.status !== 'running') emit('session.shell.ended', { shell, output: message.output ?? { output: '' } }, message.time.completed)
    } else if (message.type === 'idle') {
      emit(`session.execution.${message.outcome === 'interrupted' ? 'interrupted' : message.outcome === 'failed' ? 'failed' : 'succeeded'}`, { error: message.error })
    } else if (message.type === 'compaction') {
      emit('session.compaction.started', { reason: message.reason }, undefined, undefined, compactionIndex)
      if (message.status === 'completed') emit('session.compaction.ended', { reason: message.reason }, undefined, undefined, compactionIndex)
      if (message.status === 'failed') emit('session.compaction.failed', { error: message.error }, undefined, undefined, compactionIndex)
      compactionIndex++
    }
  }
  return events
}
