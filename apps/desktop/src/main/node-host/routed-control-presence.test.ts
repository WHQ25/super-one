import { describe, expect, it, vi } from 'vitest'
import type { ControlLease } from '@superone/shared/environment'
import { RoutedControlPresence } from './routed-control-presence'

const resource = { environmentId: 'node', sessionId: 's' }
const lease: ControlLease = { resource, leaseId: 'l', generation: '1', holderClientId: 'root', delegate: 'phone:a', expiresAt: new Date(Date.now() + 60_000).toISOString() }

describe('routed native control presence', () => {
  it('publishes the current proof after metadata resolves, including a revocation during the read', async () => {
    let finish!: (session: unknown) => void
    const session = new Promise(resolve => { finish = resolve })
    const rpc = vi.fn(async (method: string) => method === 'project.list' ? [{ projectId: 'p', path: '/p', name: 'P' }] : session)
    const publish = vi.fn()
    const failed = vi.fn()
    const presence = new RoutedControlPresence(() => ({ client: { rpc: rpc as never }, projectKey: path => `remote:connection:${path}` }), publish, failed)
    presence.changed(resource, lease)
    presence.changed(resource, null)
    finish({ sessionId: 's', projectId: 'p', harnessId: 'codex', cwd: '/p/worktree' })
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1))
    expect(publish).toHaveBeenCalledWith({ type: 'session_control_changed', sessionId: 's', projectPath: 'remote:connection:/p',
      harnessId: 'codex', acpAgentId: undefined, worktreePath: '/p/worktree', lease: null })
    expect(rpc).toHaveBeenCalledWith('session.get', { sessionId: 's', includeTranscript: false }, 'node')
    expect(failed).not.toHaveBeenCalled()
  })
  it('reuses metadata for replacement and release without undoing a newer proof', async () => {
    const publish = vi.fn()
    const rpc = vi.fn(async (method: string) => method === 'project.list' ? [{ projectId: 'p', path: '/p' }]
      : { sessionId: 's', projectId: 'p', harnessId: 'acp', acpAgentId: 'agent', cwd: '/p' })
    const presence = new RoutedControlPresence(() => ({ client: { rpc: rpc as never }, projectKey: path => path }), publish, vi.fn())
    presence.changed(resource, lease)
    const next = { ...lease, leaseId: 'next', generation: '2' }
    presence.changed(resource, next)
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1))
    expect(publish.mock.calls[0]![0]).toMatchObject({ lease: next, acpAgentId: 'agent', worktreePath: null })
    presence.changed(resource, null)
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ lease: null }))
    expect(rpc).toHaveBeenCalledTimes(2)
  })
})
