import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { createDefaultChatCoreSession } from './defaults'
import { applyEventToSession } from './reducer'

function codexPlanMessage(): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    status: 'complete',
    content: [],
    createdAt: '2026-09-04T00:00:00.000Z',
    providerId: 'codex',
    metadata: {
      codex: {
        threadId: 'thread-1',
        usage: null,
        items: [{ id: 'plan-1', type: 'plan', text: '# Plan' }],
      },
    },
  }
}

describe('Codex plan approval events', () => {
  it('updates the matching live plan card with rejection feedback', () => {
    const session = createDefaultChatCoreSession()
    session.messages = [codexPlanMessage()]

    const patch = applyEventToSession(session, {
      type: 'codex_plan_approval',
      messageId: 'assistant-1',
      status: 'rejected',
      feedback: 'Revise step 2',
    })

    expect(patch.messages?.[0].metadata?.codex?.planApproval).toEqual({
      status: 'rejected',
      feedback: 'Revise step 2',
    })
  })

  it('does not attach a plan decision to an unrelated message', () => {
    const session = createDefaultChatCoreSession()
    session.messages = [codexPlanMessage()]

    const patch = applyEventToSession(session, {
      type: 'codex_plan_approval',
      messageId: 'assistant-2',
      status: 'approved',
    })

    expect(patch.messages).toEqual(session.messages)
  })
})
