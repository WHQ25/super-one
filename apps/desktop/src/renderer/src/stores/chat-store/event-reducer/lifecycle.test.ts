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
