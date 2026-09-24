import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { createDefaultChatCoreSession } from './defaults'
import { applyEventToSession } from './reducer'
import { withoutSendFailure } from './send-failure'

function user(id: string, text = 'hi'): ChatMessage {
  return { id, role: 'user', status: 'complete', content: [{ type: 'text', text }], createdAt: '', providerId: 'local' }
}

describe('user_message_send_failed', () => {
  it('marks a live send and stops waiting for its reply', () => {
    const session = { ...createDefaultChatCoreSession(), messages: [user('u1')], awaitingAssistantReply: true }
    const patch = applyEventToSession(session, { type: 'user_message_send_failed', clientMessageId: 'u1', error: 'not connected' })
    expect(patch.messages?.[0]?.metadata?.sendFailure).toEqual({ error: 'not connected' })
    expect(patch.awaitingAssistantReply).toBe(false)
  })

  it('moves a failed queued send into the transcript instead of dropping it', () => {
    const session = {
      ...createDefaultChatCoreSession(),
      messages: [user('u1')],
      queuedMessages: [user('q1', 'next')],
      awaitingAssistantReply: true,
    }
    const patch = applyEventToSession(session, { type: 'user_message_send_failed', clientMessageId: 'q1', error: 'boom' })
    expect(patch.queuedMessages).toEqual([])
    expect(patch.messages?.map((m) => m.id)).toEqual(['u1', 'q1'])
    expect(patch.messages?.[1]?.metadata?.sendFailure).toEqual({ error: 'boom' })
    // The running turn still owns the reply indicator.
    expect(patch.awaitingAssistantReply).toBeUndefined()
  })

  it('ignores an id it does not hold', () => {
    const patch = applyEventToSession(createDefaultChatCoreSession(), { type: 'user_message_send_failed', clientMessageId: 'x', error: 'e' })
    expect(patch).toEqual({})
  })

  it('withoutSendFailure clears only the failure', () => {
    const failed: ChatMessage = { ...user('u1'), metadata: { source: 'user', sendFailure: { error: 'e' } } }
    expect(withoutSendFailure(failed).metadata).toEqual({ source: 'user' })
    const clean = user('u2')
    expect(withoutSendFailure(clean)).toBe(clean)
  })
})
