import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RelayClient } from '@superone/relay-client'
import { EventBuffer } from '@superone/relay-client'
import { createSessionView } from '../../../packages/relay-client/src/session-view'
import { prepareSessionLink, resolveSessionLink, sessionLinkBaseClient } from './session-link-navigation'
import { sessionLoadFixture } from './runtime-test-client'
import { SessionTransition } from './session-transition'
import { createMobileRelayConnection } from './mobile-relay-connection'

vi.mock('./mobile-relay-connection', () => ({ createMobileRelayConnection: vi.fn() }))
const target = { ref: { environmentId: 'node', sessionId: 'same' }, connectionId: 'connection', projectPath: 'remote:connection:/app', title: 'Target', harness: 'codex', acpAgentId: null }
function client(failRestore = false, ownTarget = target, host = 'desktop') {
  const buffer = new EventBuffer(); buffer.epoch = 3
  const rpc = vi.fn(async (method: string, _payload?: unknown, _options?: unknown): Promise<unknown> => {
    if (method === 'environment.list') return { environmentId: host }
    if (method === 'session.linkResolve') return { target: ownTarget }
    if (method === 'project.list') return [{ path: '/app', name: 'App', projectId: 'p' }]
    if (method === 'harness.options') return { options: [] }
    if (method === 'environment.descriptor') return { capabilities: { methods: [] } }
    if (method === 'session.load') {
      if (failRestore) throw Object.assign(new Error('Session locked'), { code: 'failed_precondition' })
      return sessionLoadFixture({ restore: { sourceEnvironmentId: ownTarget.ref.environmentId, mcpAppContexts: [], isWorktree: false, worktreePath: null, gitBranch: null, worktreeMissing: false } })
    }
    return { ok: true }
  })
  const close = vi.fn(async () => {})
  const base = {
    buffer, rpc, startBuffering: vi.fn(() => buffer.start()), releaseBuffer: vi.fn(() => buffer.release()), disconnect: vi.fn(),
    resolveProject: vi.fn(async () => ({ environmentId: ownTarget.ref.environmentId, projectId: 'p' })), acquireControl: vi.fn(async () => {}),
    controlledRpc: vi.fn(async () => ({ ok: true })), stopSession: vi.fn(async () => {}),
    subscribeTopics: vi.fn(async () => ({ close, update: vi.fn() })), publishSessionEvents: vi.fn(), recoverSession: vi.fn(),
    activateSessionView: vi.fn(), retainSession: () => async () => {},
    createSessionView: () => createSessionView(base as unknown as RelayClient),
  }
  return { ...base, close } as unknown as RelayClient & { close: typeof close }
}
const options = (base: RelayClient) => ({ ref: target.ref, client: base, currentPairingId: 'desktop', pairings: [] as import('@superone/relay-client').SavedPairing[], identity: { deviceId: 'phone', deviceName: 'Phone' }, resolveLan: vi.fn(async () => null), onCandidate: vi.fn() })
beforeEach(() => vi.clearAllMocks())

describe('native mobile session link preparation', () => {
  it('re-probes discovery for a verified paired desktop before dialing it', async () => {
    const pairedTarget = { ...target, ref: { environmentId: 'desktop-B', sessionId: 'same' }, connectionId: null, projectPath: '/app' }
    const candidate = client(false, pairedTarget as never, 'desktop-B')
    const connection = { client: candidate, dial: vi.fn().mockResolvedValue(undefined), adoptHooks: vi.fn(), reconnectController: { cancel: vi.fn() } }
    vi.mocked(createMobileRelayConnection).mockReturnValue(connection as never)
    const opts = options(client()); opts.ref = pairedTarget.ref
    opts.pairings = [{ id: 'B', environmentId: 'desktop-B', relayUrl: 'wss://relay', secret: 'cd'.repeat(32), keyId: 'phone-key-0001', roomId: '0f'.repeat(16), lan: 'old:123' } as never]
    const result = await prepareSessionLink(opts)
    expect(opts.resolveLan).toHaveBeenCalledWith('B'); expect(connection.dial).toHaveBeenCalledWith(null)
    expect(result.workspace?.projects).toEqual([{ path: '/app', name: 'App', projectId: 'p' }])
    result.retire(); expect(connection.reconnectController.cancel).toHaveBeenCalled()
  })
  it('prepares a scoped stream without changing the source buffer and activates only at commit', async () => {
    const base = client(), result = await prepareSessionLink(options(base))
    expect(result.restored.epoch).toBe(3); expect(result.target.projectPath).toBe('remote:connection:/app')
    expect(base.startBuffering).not.toHaveBeenCalled(); expect(base.stopSession).not.toHaveBeenCalled()
    expect(base.activateSessionView).not.toHaveBeenCalled(); expect(base.disconnect).not.toHaveBeenCalled()
    expect(base.rpc).toHaveBeenCalledWith('session.load', { sessionId: 'same', projectId: 'p', limit: 8 }, { environmentId: 'node' })
    expect(base.subscribeTopics).toHaveBeenCalledWith(expect.objectContaining({ topics: [{ kind: 'session', ...target.ref }] }), expect.any(Object))
    result.commit(); expect(base.activateSessionView).toHaveBeenCalledOnce()
    await result.client.controlledRpc(target.ref, 'session.interrupt')
    expect(base.controlledRpc).toHaveBeenCalledWith(target.ref, 'session.interrupt')
  })
  it('cleans up only a failed target and preserves source traffic', async () => {
    const base = client(true), opts = options(base)
    await expect(prepareSessionLink(opts)).rejects.toThrow('Session locked')
    expect(base.disconnect).not.toHaveBeenCalled(); expect(base.startBuffering).not.toHaveBeenCalled()
    expect(base.stopSession).not.toHaveBeenCalled(); expect(base.activateSessionView).not.toHaveBeenCalled()
    expect(opts.onCandidate).toHaveBeenLastCalledWith(null)
  })
  it('unwraps the previous view so subsequent links use the original authenticated channel', async () => {
    const base = client(), first = await prepareSessionLink(options(base)); first.commit()
    const second = await prepareSessionLink(options(first.client)); second.commit()
    expect(sessionLinkBaseClient(second.client)).toBe(base)
    expect(base.rpc).toHaveBeenCalledWith('session.linkResolve', { ref: target.ref })
    expect(base.subscribeTopics).toHaveBeenCalledTimes(2)
  })
  it('keeps workspace RPCs on the base and sends resource operations with explicit environment refs', async () => {
    const base = client(), result = await prepareSessionLink(options(base)); result.commit()
    const desktop = sessionLinkBaseClient(result.client)
    expect(desktop).toBe(base)
    await desktop.rpc('draft.list')
    await result.client.controlledRpc(target.ref, 'session.interrupt')
    expect(base.rpc).toHaveBeenCalledWith('draft.list')
    expect(base.controlledRpc).toHaveBeenCalledWith(target.ref, 'session.interrupt')
  })
  it('allows ordinary navigation during slow preflight and never subscribes a superseded candidate', async () => {
    const base = client(); let current = true, answer!: (value: unknown) => void
    vi.mocked(base.rpc).mockImplementationOnce(() => new Promise(resolve => { answer = resolve }))
    const resolving = resolveSessionLink({ ...options(base), isCurrent: () => current })
    const transition = new SessionTransition(), navigate = vi.fn(async () => { current = false })
    await transition.run(navigate); answer({ environmentId: 'desktop' })
    await expect(resolving).rejects.toThrow('superseded')
    expect(base.rpc).toHaveBeenCalledTimes(1); expect(base.subscribeTopics).not.toHaveBeenCalled()
  })
  it('resolves read-only before locking restore and rejects a late stale candidate without subscribing', async () => {
    const base = client(); let current = true
    const resolved = await resolveSessionLink({ ...options(base), isCurrent: () => current })
    expect(base.rpc).toHaveBeenCalledTimes(2); expect(base.subscribeTopics).not.toHaveBeenCalled()
    current = false; await expect(resolved.restore()).rejects.toThrow('superseded')
    expect(base.subscribeTopics).not.toHaveBeenCalled(); expect(base.activateSessionView).not.toHaveBeenCalled()
  })
  it('rejects a resolved target owner mismatch before taking control', async () => {
    const base = client()
    vi.mocked(base.rpc).mockResolvedValueOnce({ environmentId: 'desktop' }).mockResolvedValueOnce({ target: { ...target, ref: { ...target.ref, environmentId: 'other' } } })
    await expect(prepareSessionLink(options(base))).rejects.toThrow('target mismatch')
    expect(base.acquireControl).not.toHaveBeenCalled()
  })
})
