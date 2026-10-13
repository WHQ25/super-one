import type { ChatMessage, ContentBlock, MessageMetadata } from '@superone/shared/agent-types'
import { applyContentDelta } from '@superone/shared/content-delta'
import { OpenCodeV2TurnTranslator } from './opencode-v2-event-map'
import { openCodeProjectionEvents } from './opencode-v2-projection'
import type { OpenCodeV2Message } from './opencode-v2-types'

/** Rebuild native history at exact message boundaries, preserving host user identities. */
export function projectOpenCodeHistory(sessionID: string, messages: OpenCodeV2Message[], existing: ChatMessage[] = []): ChatMessage[] {
  const result: ChatMessage[] = []
  for (const message of messages) {
    if (message.type === 'user') {
      const id = typeof message.metadata?.superoneClientMessageId === 'string' ? message.metadata.superoneClientMessageId : message.id
      const prior = existing.find(item => item.id === id && item.role === 'user')
      result.push({ ...(prior ?? { id, role: 'user', status: 'complete', providerId: 'opencode',
        content: [{ type: 'text', text: message.text }], createdAt: new Date(message.time.created).toISOString() }),
        checkpointId: message.id, resumePointId: message.id })
      continue
    }
    if (message.type !== 'assistant' && message.type !== 'shell') continue
    const prior = existing.find(item => item.role === 'assistant' && item.metadata?.forkAnchorId === message.id)
    const id = prior?.id ?? `opencode-${message.id}`
    const translator = new OpenCodeV2TurnTranslator({ contextWindow: () => undefined })
    let content: ContentBlock[] = [], metadata: MessageMetadata = { forkAnchorId: message.id }
    for (const event of openCodeProjectionEvents(sessionID, [message])) for (const action of translator.apply(event, id, true)) {
      if (action.type === 'agent' && action.event.type === 'content_delta') content = applyContentDelta(content, action.event.delta, Date.now, { replace: action.event.replace })
      if (action.type === 'step_ended') metadata = { ...metadata, ...action.metadata }
    }
    result.push({ id, role: 'assistant', providerId: 'opencode', status: 'complete', content, metadata,
      createdAt: new Date(message.time.created).toISOString(), resumePointId: `opencode:${sessionID}` })
  }
  return result
}

export function nativeForkBoundary(messages: OpenCodeV2Message[], anchor?: string) {
  if (!anchor) return undefined
  const index = messages.findIndex(message => message.id === anchor)
  if (index < 0) throw new Error('Native fork anchor is unavailable; reload the session before forking')
  return messages[index + 1]?.id
}
