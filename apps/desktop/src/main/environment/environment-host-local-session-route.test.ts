import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { ControlLease } from '@superone/shared/environment'

vi.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false },
  app: { getPath: () => tmpdir(), getVersion: () => '0.0.0-test' },
}))
vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))

import { connectPhone, phoneDomain } from '../node-host/phone-endpoint-test-fixtures'
import type { FakeSession } from '../node-host/node-host-test-fixtures'
import { runWindowControl } from '../session/control-context'
import { EnvironmentHost } from './environment-host'
import { InProcessRpcClient } from './in-process-rpc-client'

const cleanup: Array<() => void> = []
afterEach(() => { while (cleanup.length) cleanup.pop()!() })

/** The window's environment route against a real desktop domain, as `window.environment` reaches it. */
function localRoute() {
  const fixture = phoneDomain(cleanup)
  const host = new EnvironmentHost(fixture.userDataDir)
  cleanup.push(() => host.dispose())
  host.registry.getLocal().bindProtocol(new InProcessRpcClient(fixture.domain))
  const forwarded: AgentEvent[] = []
  host.setAgentEventSink((event) => forwarded.push(event))
  return { ...fixture, host, forwarded }
}

describe('local sessions on the environment route', () => {
  it('reads, opens and sends without a mapped follower', async () => {
    const { host, own, forwarded } = localRoute()
    expect(await host.getSession('local', 'own')).toMatchObject({ sessionId: 'own', title: 'Mine' })
    const snapshot = await runWindowControl(7, () => host.openRemoteSession('local', { sessionId: 'own', projectPath: own.projectPath }))
    expect(snapshot.sessionId).toBe('own')

    await runWindowControl(7, () => host.sendSessionMessage('local', {
      sessionId: 'own', text: 'hello', clientMessageId: 'c1', projectPath: own.projectPath,
      priority: 'next', modelParams: { fast: 'true' }, inputRequest: { requestId: 'r1', values: { a: 1 } },
    }))
    expect(own.sent).toHaveLength(1)
    expect(own.sent[0]).toMatchObject({ content: 'hello', clientMessageId: 'c1', priority: 'next', cursor: { params: { fast: 'true' } }, inputRequest: { requestId: 'r1' } })
    // The desktop hub already carries local events; a follower would repeat each one.
    own.emitHostEvent({ type: 'status_change', status: 'streaming' } as AgentEvent)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(forwarded).toEqual([])
  })

  it('carries settings, answers and Codex selections to the session', async () => {
    const { host, own } = localRoute()
    await runWindowControl(7, () => host.patchSessionSettings('local', 'own', { permissionMode: 'plan', model: 'opus', ultracode: true, contextWindow: 1_000_000 }))
    expect(own).toMatchObject({ permissionMode: 'plan', model: 'opus', ultracode: true, contextWindow: 1_000_000 })

    own.pending = [{ type: 'permission_request', request: { requestId: 'p1', toolName: 'Bash', input: {} } } as unknown as AgentEvent]
    await runWindowControl(7, () => host.respondSessionPermission('local', { sessionId: 'own', interactionId: 'p1', decision: 'deny', reason: 'no', selectedSuggestions: [1] }))
    expect(own.permissionAnswers[0]).toEqual(['p1', false, false, 'no', [1], undefined, undefined])

    own.harnessId = 'codex'
    await runWindowControl(7, () => host.sendSessionMessage('local', {
      sessionId: 'own', text: 'go', clientMessageId: 'c2', threadId: 't1', serviceTier: 'fast', permissionPreset: 'full-access', turnKind: 'review',
    }))
    expect(own.sent.at(-1)?.codex).toMatchObject({ mode: 'review', threadId: 't1', serviceTier: 'fast', permissionPreset: 'full-access' })
  })

  it('gives each window its own grant, yields to a phone, and edits metadata without one', async () => {
    const { host, domain, store } = localRoute()
    await runWindowControl(7, () => host.interruptSession('local', 'own'))
    await expect(host.interruptSession('local', 'own')).rejects.toThrow('local session control needs a window')

    const phone = await connectPhone(domain, { deviceId: 'a' })
    cleanup.push(phone.close)
    expect((await phone.rpc<ControlLease>('session.acquireControl', { sessionId: 'own' })).delegate).toBe('phone:a')
    await expect(runWindowControl(7, () => host.interruptSession('local', 'own'))).rejects.toMatchObject({ code: 'failed_precondition' })
    await expect(runWindowControl(8, () => host.interruptSession('local', 'own'))).rejects.toMatchObject({ code: 'failed_precondition' })

    await runWindowControl(8, () => host.renameSession('local', 'own', 'Renamed'))
    await runWindowControl(8, () => host.setSessionUiFlags('local', 'own', { isPinned: true }))
    expect(store.rows.get('own')).toMatchObject({ title: 'Renamed', isPinned: true })
  })

  it('serves a side chat while it runs without storing it', async () => {
    const { host, sessions, store, projectDir } = localRoute()
    const side = sessions.createSession({ id: 'side', projectPath: projectDir }) as unknown as FakeSession
    side.ephemeral = true
    expect(await host.getSession('local', 'side')).toMatchObject({ sessionId: 'side', isHidden: true })
    await runWindowControl(7, () => host.sendSessionMessage('local', { sessionId: 'side', text: 'aside' }))
    side.pending = [{ type: 'permission_request', request: { requestId: 'p2', toolName: 'Bash', input: {} } } as unknown as AgentEvent]
    await runWindowControl(7, () => host.respondSessionPermission('local', { sessionId: 'side', interactionId: 'p2', decision: 'allow' }))
    await runWindowControl(7, () => host.interruptSession('local', 'side'))
    expect(side.sent.map((request) => request.content)).toEqual(['aside'])
    expect(store.rows.has('side')).toBe(false)
  })

  it('tears a live session down before deleting its row', async () => {
    const { host, sessionEdits, sessions, store } = localRoute()
    const order: string[] = []
    const close = sessionEdits.close
    vi.spyOn(sessionEdits, 'close').mockImplementation(async (id) => { order.push('dispose'); await close(id) })
    const remove = sessionEdits.remove
    vi.spyOn(sessionEdits, 'remove').mockImplementation((id) => { order.push('delete'); remove(id) })
    await runWindowControl(7, () => host.removeSession('local', 'own'))
    expect(order).toEqual(['dispose', 'delete'])
    expect(sessions.live.has('own')).toBe(false)
    expect(store.rows.has('own')).toBe(false)
  })

  it('restores a cold session with its stored settings and whole transcript', async () => {
    const stored = { provider: 'codex', selectedModel: 'gpt-6', codexServiceTier: 'fast', acpAgentId: null, title: 'Mine', totalCostUsd: 1, contextTokens: 2 }
    const fixture = phoneDomain(cleanup, { restore: { stored: (id) => id === 'own' ? stored as never : null } })
    const host = new EnvironmentHost(fixture.userDataDir)
    cleanup.push(() => host.dispose())
    host.registry.getLocal().bindProtocol(new InProcessRpcClient(fixture.domain))
    const loaded = await host.openRemoteSession('local', { sessionId: 'own', full: true })
    expect(loaded.state).toMatchObject({ stored })
    expect(loaded.before).toBeNull()
  })

  it('creates and forks local sessions', async () => {
    const { host, store, own } = localRoute()
    const created = await runWindowControl(7, () => host.createSession('local', { projectId: 'p1', title: 'New', harnessId: 'claude', selections: { sessionId: 'chosen' } }))
    expect(created).toMatchObject({ sessionId: 'chosen' })
    expect(store.rows.has('chosen')).toBe(true)
    expect(own.sent).toEqual([])
  })
})
