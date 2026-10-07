import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RelayClient } from '@superone/relay-client'
import { prepareSessionLink, resolveSessionLink, sessionLinkBaseClient } from './session-link-navigation'
import { SessionTransition } from './session-transition'
import { createMobileRelayConnection } from './mobile-relay-connection'

vi.mock('./mobile-relay-connection', () => ({ createMobileRelayConnection: vi.fn() }))
const target = { ref: { environmentId: 'node', sessionId: 'same' }, connectionId: 'connection', projectPath: 'remote:connection:/app', title: 'Target', harness: 'codex', acpAgentId: null }
function client(failRestore = false) {
  return { buffer: { epoch: 3 }, request: vi.fn(async (command: Record<string, unknown>) => {
    if (command.type === 'session_link_identity') return { environmentId: 'desktop' }
    if (command.type === 'session_link_resolve') return { target }
    if (command.type === 'environment_command') {
      if (failRestore) return { error: 'Session locked' }
      return { historyPage: { messages: [], hasMore: false, cursor: null }, snapshot: { sourceEnvironmentId: 'node', status: 'idle' } }
    }
    throw new Error('Unexpected command')
  }), send: vi.fn(), startBuffering: vi.fn(), releaseBuffer: vi.fn(), disconnect: vi.fn() } as unknown as RelayClient
}
const options = (base: RelayClient) => ({ ref: target.ref, client: base, currentPairingId: 'desktop', pairings: [] as import('@superone/relay-client').SavedPairing[], identity: { deviceId: 'phone', deviceName: 'Phone' }, resolveLan: vi.fn(async () => null), onCandidate: vi.fn() })
beforeEach(() => vi.clearAllMocks())
describe('mobile session link preparation', () => {
  it('re-probes discovery for a verified paired desktop before dialing it', async () => {
    const candidate = client()
    const pairedTarget = { ...target, ref: { environmentId: 'desktop-B', sessionId: 'same' }, connectionId: null, projectPath: '/app' }
    vi.mocked(candidate.request).mockImplementation(async command => command.type === 'session_link_identity' ? { environmentId: 'desktop-B' } : command.type === 'session_link_resolve' ? { target: pairedTarget } : command.type === 'list_projects' ? { projects: [{ path: '/app', name: 'App' }] } : command.type === 'list_harness_options' ? { options: [] } : { historyPage: { messages: [], hasMore: false, cursor: null }, snapshot: { sourceEnvironmentId: 'desktop-B', status: 'idle' } })
    const connection = { client: candidate, dial: vi.fn().mockResolvedValue(undefined), adoptHooks: vi.fn(), reconnectController: { cancel: vi.fn() } }
    vi.mocked(createMobileRelayConnection).mockReturnValue(connection as never)
    const opts = options(client())
    opts.ref = pairedTarget.ref
    opts.pairings = [{ id: 'B', environmentId: 'desktop-B', relayUrl: 'wss://relay', secret: 'secret', lan: 'old:123' } as never]
    const result = await prepareSessionLink(opts)
    expect(opts.resolveLan).toHaveBeenCalledWith('B')
    expect(connection.dial).toHaveBeenCalledWith(null)
    expect(result.connection).toBe(connection)
    expect(result.workspace?.projects).toEqual([{ path: '/app', name: 'App' }])
    result.retire()
    expect(connection.reconnectController.cancel).toHaveBeenCalled()
  })
  it('restores the explicit route without pausing or disconnecting the source', async () => {
    const base = client(), opts = options(base)
    const result = await prepareSessionLink(opts)
    expect(result.restored.epoch).toBe(3)
    expect(result.target.projectPath).toBe('/app')
    expect(base.startBuffering).not.toHaveBeenCalled()
    expect(base.disconnect).not.toHaveBeenCalled()
    expect(base.request).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'environment_command', environmentId: 'node', command: expect.objectContaining({ type: 'subscribe_session', preserveSubscriptions: true }) }), undefined)
    result.commit()
    result.client.send({ type: 'interrupt', projectPath: '/app', sessionId: 'same' })
    expect(base.send).toHaveBeenLastCalledWith(expect.objectContaining({ environmentId: 'node', command: expect.objectContaining({ type: 'interrupt' }) }))
  })
  it('cleans up only a failed target and preserves source traffic', async () => {
    const base = client(true), opts = options(base)
    await expect(prepareSessionLink(opts)).rejects.toThrow('Session locked')
    expect(base.disconnect).not.toHaveBeenCalled()
    expect(base.startBuffering).not.toHaveBeenCalled()
    expect(base.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'environment_command', command: { type: 'unsubscribe_session', sessionId: 'same' } }))
    expect(opts.onCandidate).toHaveBeenLastCalledWith(null)
  })
  it('unwraps the previous route instead of nesting environment envelopes', async () => {
    const base = client()
    const first = await prepareSessionLink(options(base)); first.commit()
    const second = await prepareSessionLink(options(first.client)); second.commit()
    expect(base.request).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'environment_command', command: expect.objectContaining({ type: 'subscribe_session' }) }), undefined)
  })
  it('uses the explicit base client for workspace lists, drafts and row management while preserving session routing', async () => {
    const base = client()
    const result = await prepareSessionLink(options(base)); result.commit()
    const desktop = sessionLinkBaseClient(result.client)
    expect(desktop).toBe(base)
    desktop.send({ type: 'list_projects', requestId: 'projects' })
    expect(base.send).toHaveBeenLastCalledWith({ type: 'list_projects', requestId: 'projects' })
    for (const command of [
      { type: 'pin_session', requestId: 'pin', projectPath: '/desktop', sessionId: 'same', pinned: true },
      { type: 'archive_session', requestId: 'archive', projectPath: '/desktop', sessionId: 'same' },
      { type: 'delete_session', requestId: 'delete', projectPath: '/desktop', sessionId: 'same' },
    ] as const) {
      desktop.send(command)
      expect(base.send).toHaveBeenLastCalledWith(command)
    }
    desktop.send({ type: 'list_drafts', requestId: 'drafts' })
    expect(base.send).toHaveBeenLastCalledWith({ type: 'list_drafts', requestId: 'drafts' })
    result.client.send({ type: 'list_sessions', requestId: 'session-resources', projectPath: '/app' })
    expect(base.send).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'environment_command', environmentId: 'node' }))
    result.client.send({ type: 'leave_session', sessionId: 'same' })
    expect(base.send).toHaveBeenLastCalledWith(expect.objectContaining({ environmentId: 'node', command: { type: 'leave_session', sessionId: 'same' } }))
    desktop.send({ type: 'create_session', requestId: 'create', projectPath: '/desktop', sessionId: 'new' })
    expect(base.send).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'create_session', projectPath: '/desktop' }))
    result.retire()
    expect(base.send).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'create_session' }))
  })
  it('allows ordinary navigation during slow preflight and never subscribes a superseded candidate', async () => {
    const base = client(), opts = { ...options(base), isCurrent: () => current }
    let current = true
    let answer!: (identity: { environmentId: string }) => void
    vi.mocked(base.request).mockImplementationOnce(() => new Promise(resolve => { answer = resolve }))
    const resolving = resolveSessionLink(opts)
    const transition = new SessionTransition()
    const navigate = vi.fn(async () => { current = false })
    await transition.run(navigate)
    answer({ environmentId: 'desktop' })
    await expect(resolving).rejects.toThrow('superseded')
    expect(navigate).toHaveBeenCalledOnce()
    expect(base.request).toHaveBeenCalledTimes(1)
    expect(base.send).not.toHaveBeenCalled()
    expect(base.disconnect).not.toHaveBeenCalled()
  })
  it('performs read-only resolution before locking subscription restore and rejects late stale restores without traffic', async () => {
    const base = client()
    let current = true
    const resolved = await resolveSessionLink({ ...options(base), isCurrent: () => current })
    expect(base.request).toHaveBeenCalledTimes(2)
    current = false
    await expect(new SessionTransition().run(() => resolved.restore())).rejects.toThrow('superseded')
    expect(base.request).toHaveBeenCalledTimes(2)
    expect(base.send).not.toHaveBeenCalled()
  })
  it('rejects an authenticated target owner mismatch before commit', async () => {
    const base = client()
    vi.mocked(base.request).mockImplementationOnce(async () => ({ environmentId: 'desktop' })).mockImplementationOnce(async () => ({ target: { ...target, ref: { ...target.ref, environmentId: 'other' } } }))
    await expect(prepareSessionLink(options(base))).rejects.toThrow('target mismatch')
    expect(base.send).not.toHaveBeenCalled()
  })
})
