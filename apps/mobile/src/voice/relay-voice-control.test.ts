import { expect, it, vi } from 'vitest'
import { relayVoiceControl } from './relay-voice-control'

function fixture() {
  const status = { protocol: 1 as const, supported: true, call: null }
  const release = vi.fn(async () => {})
  const client = {
    resolveProject: vi.fn(async () => ({ environmentId: 'host', projectId: 'p' })),
    rpc: vi.fn(async () => status), controlledRpc: vi.fn(async () => status),
    acquireControl: vi.fn(async () => ({})), retainSession: vi.fn(() => release),
  }
  return { client, release }
}
it('uses canonical native RPCs and keeps cleanup scoped to the source session', async () => {
  const { client, release } = fixture()
  const selection = { model: 'displayed', reasoningEffort: 'ultra' as const, serviceTier: null, apiProviderId: 'codex-account:cli' }
  const control = relayVoiceControl(client as never, { projectPath: '/repo', sessionId: 'current' }, ['/extra'], selection)
  await control.status()
  expect(client.rpc).toHaveBeenLastCalledWith('session.voiceStatus', { sessionId: 'current' }, { environmentId: 'host' })
  await control.start('one', 'v=0\na=offer')
  expect(client.controlledRpc).toHaveBeenLastCalledWith({ environmentId: 'host', sessionId: 'current' }, 'session.voiceStart', { attemptId: 'one', request: { sdp: 'v=0\na=offer', additionalDirs: ['/extra'], selection } })
  await control.stop('old', { projectPath: '/source', sessionId: 'source' })
  expect(client.controlledRpc).toHaveBeenLastCalledWith({ environmentId: 'host', sessionId: 'source' }, 'session.voiceStop', { attemptId: 'old' })
  await control.release?.(); await control.release?.()
  expect(release).toHaveBeenCalledTimes(2)
})
it('does not retain or acquire a late resource after cancellation', async () => {
  const { client } = fixture()
  let resolve!: (project: { environmentId: string; projectId: string }) => void
  client.resolveProject.mockImplementation(() => new Promise(done => { resolve = done }))
  const control = relayVoiceControl(client as never, { projectPath: '/repo', sessionId: 's' })
  const pending = control.start('one', 'v=0\na=offer')
  await control.release?.()
  resolve({ environmentId: 'host', projectId: 'p' })
  await expect(pending).rejects.toThrow('Voice attempt ended')
  expect(client.retainSession).not.toHaveBeenCalled()
  expect(client.acquireControl).not.toHaveBeenCalled()
})
it('waits for an admitted grant before releasing a cancelled attempt', async () => {
  const { client, release } = fixture()
  let resolve!: (grant: {}) => void
  client.acquireControl.mockImplementation(() => new Promise(done => { resolve = done }))
  const control = relayVoiceControl(client as never, { projectPath: '/repo', sessionId: 's' })
  const pending = control.start('one', 'v=0\na=offer')
  await vi.waitFor(() => expect(client.acquireControl).toHaveBeenCalledTimes(1))
  const released = control.release?.()
  expect(release).not.toHaveBeenCalled()
  resolve({})
  await expect(pending).rejects.toThrow('Voice attempt ended')
  await released
  expect(release).toHaveBeenCalledTimes(1)
  expect(client.controlledRpc).not.toHaveBeenCalled()
})
