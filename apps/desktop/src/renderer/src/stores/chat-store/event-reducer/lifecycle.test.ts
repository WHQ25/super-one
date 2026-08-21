/** @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'

vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ sandboxCapability: null }) } }))
vi.mock('@/stores/activity-view-state', () => ({ useActivityViewStateStore: { getState: () => ({}) } }))
vi.stubGlobal('window', {
  agent: new Proxy({}, { get: () => () => Promise.resolve(undefined) }),
  app: { trace: vi.fn(), getAppSettings: vi.fn().mockResolvedValue({ agentPreference: {} }) },
})

await import('../index')
const { createDefaultPerSessionState } = await import('../defaults')
const { reduceLifecycle } = await import('./lifecycle')

function msg(id: string, role: 'user' | 'assistant', status: ChatMessage['status'] = 'complete'): ChatMessage {
  return { id, role, status, content: [], createdAt: '', providerId: 'acp' }
}

describe('reduceLifecycle: status_change with leftover queued messages', () => {
  it('does not splice queued messages before the last assistant on idle', () => {
    const session = createDefaultPerSessionState()
    session.status = 'streaming'
    session.messages = [msg('user-1', 'user'), msg('asst-1', 'assistant')]
    session.queuedMessages = [msg('user-2', 'user')]

    const patch = reduceLifecycle(session, { type: 'status_change', status: 'idle' } as never)

    expect(patch.status).toBe('idle')
    expect(patch.queuedMessages).toBeUndefined()
    expect(patch.messages).toBeUndefined()
  })

  it('does not splice queued messages before the last assistant on error', () => {
    const session = createDefaultPerSessionState()
    session.status = 'streaming'
    session.messages = [msg('user-1', 'user'), msg('asst-1', 'assistant')]
    session.queuedMessages = [msg('user-2', 'user')]

    const patch = reduceLifecycle(session, { type: 'status_change', status: 'error' } as never)

    expect(patch.status).toBe('error')
    expect(patch.queuedMessages).toBeUndefined()
    expect(patch.messages).toBeUndefined()
  })
})

describe('reduceLifecycle: Grok queued-turn handoff', () => {
  it('keeps the queued user after the completed assistant once consume lands', () => {
    const session = createDefaultPerSessionState()
    session.status = 'streaming'
    session.messages = [msg('user-1', 'user'), msg('asst-1', 'assistant')]
    session.queuedMessages = [msg('user-2', 'user')]

    const afterIdle = { ...session, ...reduceLifecycle(session, { type: 'status_change', status: 'idle' } as never) }
    const afterConsume = {
      ...afterIdle,
      ...reduceLifecycle(afterIdle, { type: 'queued_message_consumed', clientMessageId: 'user-2' } as never),
    }
    const afterStart = {
      ...afterConsume,
      ...reduceLifecycle(afterConsume, {
        type: 'message_start',
        message: msg('asst-2', 'assistant', 'streaming'),
      } as never),
    }

    expect(afterStart.messages.map((m) => m.id)).toEqual(['user-1', 'asst-1', 'user-2', 'asst-2'])
    expect(afterStart.queuedMessages).toEqual([])
  })
})

/**
 * `command_lifecycle` is an undeclared SDK wire message, so its terminal state may
 * silently stop arriving. Clearing on the turn ending too means a dropped
 * completed/cancelled can never strand a permanent "running /x" indicator.
 */
describe('reduceLifecycle: running slash command is cleared when the turn ends', () => {
  it('clears the running marker once the turn goes idle', () => {
    const session = createDefaultPerSessionState()
    session.runningSlashCommand = { command: 'code-review', startedAt: 1 }

    expect(reduceLifecycle(session, { type: 'status_change', status: 'idle' } as never)
      .runningSlashCommand).toBeNull()
  })

  it('clears the running marker when the turn errors out', () => {
    const session = createDefaultPerSessionState()
    session.runningSlashCommand = { command: 'code-review', startedAt: 1 }

    expect(reduceLifecycle(session, { type: 'status_change', status: 'error' } as never)
      .runningSlashCommand).toBeNull()
  })

  it('leaves the marker alone while the turn is still streaming', () => {
    const session = createDefaultPerSessionState()
    session.runningSlashCommand = { command: 'code-review', startedAt: 1 }

    expect(reduceLifecycle(session, { type: 'status_change', status: 'streaming' } as never)
      .runningSlashCommand).toBeUndefined()
  })
})

describe('reduceLifecycle: messages_retracted', () => {
  it('evicts the refused partial so it does not linger above the retry', () => {
    const session = createDefaultPerSessionState()
    session.messages = [msg('u1', 'user'), msg('a1', 'assistant'), msg('a2', 'assistant')]

    const patch = reduceLifecycle(session, { type: 'messages_retracted', messageIds: ['a1'] } as never)

    expect(patch.messages?.map((m) => m.id)).toEqual(['u1', 'a2'])
  })

  it('is a no-op for ids already gone, so a replayed eviction cannot churn state', () => {
    const session = createDefaultPerSessionState()
    session.messages = [msg('a1', 'assistant')]

    expect(reduceLifecycle(session, { type: 'messages_retracted', messageIds: ['gone'] } as never)).toEqual({})
  })
})
