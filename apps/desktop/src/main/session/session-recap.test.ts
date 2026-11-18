import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'

const notifySessionRecapForegroundMock = vi.fn()
const notifySessionRecapSessionRemovedMock = vi.fn()

vi.mock('../logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../acp/acp-recap-focus', () => ({
  notifySessionRecapForeground: (...args: unknown[]) => notifySessionRecapForegroundMock(...args),
  notifySessionRecapSessionRemoved: (...args: unknown[]) => notifySessionRecapSessionRemovedMock(...args),
}))

import { acquirePhoneControl, controlLeaseAuthority } from '../control-lease.test-fixtures'
import { Session } from './session'
import { FakeBackend } from './session-test-backend'

function sampleUserMessage(): ChatMessage {
  return {
    id: 'm1',
    role: 'user',
    status: 'complete',
    content: [{ type: 'text', text: 'hello' }],
    createdAt: new Date().toISOString(),
    providerId: 'acp',
  }
}

describe('Session recap eligibility and external lease guard', () => {
  it('does not enroll acp-antigravity sessions in away recap polling or dispatch requestSessionRecap', async () => {
    const backend = new FakeBackend()
    backend.activeRuntime = true
    const session = new Session({
      id: 'agy-1',
      harnessId: 'acp-antigravity',
      providerId: 'acp-antigravity',
      projectPath: '/tmp/proj',
      cwd: '/tmp/proj',
      config: {},
      permissionMode: 'default',
      initialMessages: [sampleUserMessage()],
      backend,
    })

    notifySessionRecapForegroundMock.mockClear()
    session.setForeground(true)
    session.setForeground(false)
    expect(notifySessionRecapForegroundMock).not.toHaveBeenCalled()

    await expect(session.requestSessionRecap(true)).resolves.toBe(false)
    expect(backend.requestSessionRecapCalls).toHaveLength(0)
  })

  it('skips host auto recap when a phone holds an external lease on an acp-grok session', async () => {
    const authority = controlLeaseAuthority()
    const backend = new FakeBackend()
    backend.activeRuntime = true
    const session = new Session({
      id: 'grok-1',
      harnessId: 'acp-grok',
      providerId: 'acp-base',
      projectPath: '/tmp/proj',
      cwd: '/tmp/proj',
      config: {},
      permissionMode: 'default',
      initialMessages: [sampleUserMessage()],
      leaseAuthority: authority,
      backend,
    })

    acquirePhoneControl(authority, 'grok-1', 'iphone-1')
    await expect(session.requestSessionRecap(true)).resolves.toBe(false)
    expect(backend.requestSessionRecapCalls).toHaveLength(0)
  })
})
