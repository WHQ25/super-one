import { describe, expect, it, vi } from 'vitest'
import { ChatRuntime } from './runtime'

function fakeClient() {
  const sent: unknown[] = []
  return {
    sent,
    startBuffering() {},
    releaseBuffer() { return { epoch: 1, batches: [] } },
    send: vi.fn((cmd: { type: string }) => { sent.push(cmd) }),
    request: vi.fn(async (cmd: { type: string; sessionId?: string }) => {
      sent.push(cmd)
      if (cmd.type === 'subscribe_session') return { ok: true }
      if (cmd.type === 'load_session_messages') return { messages: [], hasMore: false }
      if (cmd.type === 'get_session_state') return { status: 'idle', pendingInteractions: [], inProgressMessages: [] }
      if (cmd.type === 'create_session') return { ok: true, sessionId: cmd.sessionId }
      if (cmd.type === 'get_system_info') {
        return { userSlashCommands: [{ name: 'help' }], permissionModes: ['default', 'plan'], models: [{ id: 'm' }] }
      }
      return { ok: true }
    }),
  }
}

describe('ChatRuntime', () => {
  it('create_session then restore, and loads slash commands', async () => {
    const client = fakeClient()
    const paints: unknown[] = []
    const runtime = new ChatRuntime(client as never, (s) => paints.push(s))
    const id = await runtime.create('/p', { provider: 'claude' })
    expect(id).toBeTruthy()
    expect(client.sent.some((c) => (c as { type: string }).type === 'create_session')).toBe(true)
    const info = await runtime.loadSystemInfo('claude')
    expect(runtime.slashCommands).toEqual([{ name: 'help' }])
    expect(info.permissionModes).toContain('plan')
    await runtime.setPermissionMode('plan')
    expect(runtime.permissionMode).toBe('plan')
  })
})
