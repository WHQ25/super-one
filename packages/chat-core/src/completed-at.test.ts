import { describe, expect, it } from 'vitest'
import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import { createDefaultChatCoreSession } from './defaults'
import { applyEventToSession } from './reducer'

const at = '2026-10-08T05:00:00.000Z'

function streaming(): ChatMessage {
  return { id: 'a1', role: 'assistant', status: 'streaming', content: [], createdAt: '2026-10-08T04:59:00.000Z', providerId: 'claude' }
}

describe('turn completion time', () => {
  it.each<AgentEvent>([
    { type: 'message_complete', messageId: 'a1', metadata: { completedAt: at } },
    { type: 'message_interrupted', messageId: 'a1', metadata: { completedAt: at } },
    { type: 'message_error', messageId: 'a1', error: 'boom', metadata: { completedAt: at } },
  ])('lands on the message for $type', (event) => {
    const session = { ...createDefaultChatCoreSession(), messages: [streaming()] }
    expect(applyEventToSession(session, event).messages?.[0]?.metadata?.completedAt).toBe(at)
  })
})
