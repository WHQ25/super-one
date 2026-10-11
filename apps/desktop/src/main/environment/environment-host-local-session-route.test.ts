import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { ControlLease } from '@superone/shared/environment'

vi.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false },
  app: { getPath: () => tmpdir(), getVersion: () => '0.0.0-test' },
}))
vi.mock('../session/session-preferences', () => ({ readDefaultSessionPrefs: () => ({ permissionMode: 'default', sandboxMode: 'on' }) }))
vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))

import type { DesktopDomainDeps } from '../node-host/desktop-domain'
import { connectPhone, phoneDomain } from '../node-host/phone-endpoint-test-fixtures'
import type { FakeSession } from '../node-host/node-host-test-fixtures'
import { createPhoneMethods } from '../remote/phone-methods'
import type { Session } from '../session/types'
import { runWindowControl } from '../session/control-context'
import { EnvironmentHost } from './environment-host'
import { InProcessRpcClient } from './in-process-rpc-client'

const cleanup: Array<() => void> = []
afterEach(() => { while (cleanup.length) cleanup.pop()!() })

/** The window's environment route against a real desktop domain, as `window.environment` reaches it. */
function localRoute(extra: Partial<DesktopDomainDeps> = {}) {
  const fixture = phoneDomain(cleanup, extra)
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

  it('reaches the queue and the goal through one session call', async () => {
    const live: { getSession?: (id: string) => Session | null } = {}
    const { host, own, sessions } = localRoute({
      phoneMethods: createPhoneMethods({ sessions: { getSession: (id) => live.getSession!(id) }, agent: {} as never }),
    })
    live.getSession = (id) => sessions.getSession(id)
    own.queued = ['q1']
    expect(await runWindowControl(7, () => host.callSession('local', 'own', 'session.dequeue', { clientMessageId: 'q1' }))).toEqual({ removed: true })
    expect(await runWindowControl(7, () => host.callSession('local', 'own', 'session.steer', { clientMessageId: 'q2', priority: 'next' }))).toEqual({ ok: true })
    expect(own.commands.at(-1)).toEqual({ kind: 'claude.steer_queued', clientMessageId: 'q2', priority: 'next' })

    own.harnessId = 'codex'
    await runWindowControl(7, () => host.callSession('local', 'own', 'session.setGoal', { objective: 'ship it' }))
    // A read takes no grant, so it needs no window.
    expect(await host.callSession('local', 'own', 'session.getGoal', {})).toEqual({ goal: { objective: 'ship it', status: 'active' } })
    await runWindowControl(7, () => host.callSession('local', 'own', 'session.setGoal', { objective: null }))
    expect(own.goal).toBeNull()
    await expect(host.callSession('local', 'own', 'session.dequeue', { clientMessageId: 'q1' })).rejects.toThrow('local session control needs a window')
    await expect(runWindowControl(7, () => host.callSession('local', 'own', 'session.remove' as never, {} as never))).rejects.toMatchObject({ code: 'invalid_argument' })
  })

  it('creates and forks local sessions', async () => {
    const { host, store, own } = localRoute()
    const created = await runWindowControl(7, () => host.createSession('local', { projectId: 'p1', title: 'New', harnessId: 'claude', selections: { sessionId: 'chosen' } }))
    expect(created).toMatchObject({ sessionId: 'chosen' })
    expect(store.rows.has('chosen')).toBe(true)
    expect(own.sent).toEqual([])
  })
})


describe('rewind on the local environment endpoint', () => {
  it('addresses the named session, validates the mode and makes preview a read', async () => {
    const { host, own, sessions, domain } = localRoute()
    const rewind = vi.fn(async () => { own.lease.assertMutation(); return { canRewind: true } })
    const preview = vi.fn(async (_checkpoint: string, options?: { dryRun?: boolean }) => {
      if (!options?.dryRun) own.lease.assertMutation()
      return { canRewind: true }
    })
    const truncate = vi.fn(() => own.lease.assertMutation())
    Object.assign(own, { rewindFiles: preview, rewindConversation: rewind, truncateMessagesAt: truncate })
    sessions.setActiveSession(own.projectPath, 'other')
    const descriptor = await new InProcessRpcClient(domain).getDescriptor()
    expect(descriptor.capabilities.methods).toContain('session.rewind')
    await host.callSession('local', 'own', 'session.previewRewind', { checkpointId: 'cp' })
    expect(preview).toHaveBeenCalledWith('cp', { dryRun: true })
    await runWindowControl(7, () => host.callSession('local', 'own', 'session.rewind', { checkpointId: 'cp', mode: 'code+chat' }))
    expect(preview).toHaveBeenCalledWith('cp', { includeConversation: true })
    await runWindowControl(7, () => host.callSession('local', 'own', 'session.rewind', { checkpointId: 'cp', mode: 'conversation' }))
    expect(rewind).toHaveBeenCalledWith('cp')
    await runWindowControl(7, () => host.callSession('local', 'own', 'session.truncateAtCheckpoint', { checkpointId: 'cp' }))
    expect(truncate).toHaveBeenCalledWith('cp')
    await expect(runWindowControl(7, () => host.callSession('local', 'own', 'session.rewind', { checkpointId: 'cp', mode: 'bad' as never }))).rejects.toMatchObject({ code: 'invalid_argument' })
    await expect(host.callSession('local', 'own', 'session.rewind', { checkpointId: 'cp', mode: 'files' })).rejects.toThrow('local session control needs a window')
  })
})


describe('turn control on the local environment endpoint', () => {
  it('stops a task, starts a queue and resets the named session without changing another runtime', async () => {
    const { host, own, sessions } = localRoute()
    sessions.createSession({ id: 'other', projectPath: own.projectPath })
    vi.spyOn(own, 'snapshot', 'get').mockReturnValue({ ...own.snapshot, projectPath: own.projectPath, providerId: 'claude-base' } as typeof own.snapshot)
    const startQueued = vi.fn(async () => { own.lease.assertMutation(); return true })
    Object.assign(own, { startQueuedMessages: startQueued })
    sessions.setActiveSession(own.projectPath, 'other')
    await runWindowControl(7, () => host.callSession('local', 'own', 'session.stopTask', { taskId: 'task' }))
    expect(own.commands.at(-1)).toEqual({ kind: 'claude.stop_task', taskId: 'task' })
    expect(await runWindowControl(7, () => host.callSession('local', 'own', 'session.startQueued', {}))).toBe(true)
    const other = sessions.getSession('other')
    await expect(runWindowControl(7, () => host.callSession('local', 'own', 'session.reset', { newSessionId: 'own' }))).rejects.toMatchObject({ code: 'invalid_argument' })
    expect(sessions.getSession('own')).toBe(own)
    const fresh = await runWindowControl(7, () => host.callSession('local', 'own', 'session.reset', { newSessionId: 'fresh' }))
    expect(fresh?.permissionMode).toBe('default')
    expect(sessions.getSession('own')).toBeNull()
    expect(sessions.getSession('fresh')).toBeTruthy()
    expect(sessions.getSession('other')).toBe(other)
    await runWindowControl(7, () => host.callSession('local', 'fresh', 'session.reset', {}))
    expect(sessions.getSession('fresh')).toBeNull()
  })
})


describe('session introspection on the local environment endpoint', () => {
  it('reads without control and fences MCP authentication on the named session', async () => {
    const { host, own } = localRoute()
    const context = { totalTokens: 12, maxTokens: 100, percentage: 12, categories: [] }
    const authenticate = vi.fn(async () => { own.lease.assertMutation() })
    Object.assign(own, { getContextUsage: async () => context, getMcpServerStatus: async () => [{ name: 'github', status: 'needs-auth' }], authenticateMcp: authenticate })
    expect(await host.callSession('local', 'own', 'session.contextUsage', {})).toEqual(context)
    expect(await host.callSession('local', 'own', 'session.mcpStatus', {})).toEqual([{ name: 'github', status: 'needs-auth' }])
    await runWindowControl(7, () => host.callSession('local', 'own', 'session.mcpAuthenticate', { serverName: 'github' }))
    expect(authenticate).toHaveBeenCalledWith('github')
    await expect(runWindowControl(7, () => host.callSession('local', 'own', 'session.mcpAuthenticate', { serverName: '' }))).rejects.toMatchObject({ code: 'invalid_argument' })
    await expect(host.callSession('local', 'own', 'session.mcpAuthenticate', { serverName: 'github' })).rejects.toThrow('local session control needs a window')
  })
})

describe('side chats on the local environment endpoint', () => {
  it('creates and closes a live child without a catalog row or changing the parent', async () => {
    let manager: ReturnType<typeof localRoute>['sessions']
    let projectPath: string
    const { host, sessions, own, projectDir, store } = localRoute({ sideChats: {
      start: async (parentSessionId, assertControl) => {
        expect(parentSessionId).toBe('own')
        assertControl()
        const child = manager.createSession({ id: 'side', projectPath })
        Object.assign(child, { ephemeral: true })
        child.lease.grantCreatedSession()
        return { ok: true, sessionId: 'side', projectPath, cwd: projectPath, harnessId: 'claude', providerId: 'claude-base', apiProviderId: null, acpAgentId: null, selectedModel: null, selectedEffort: null, agentPreset: null }
      },
      close: async (id) => { manager.getSession(id)!.lease.assertMutation(); await manager.disposeSession(id); return true },
    } })
    manager = sessions; projectPath = projectDir
    const opened = await runWindowControl(7, () => host.callSession('local', 'own', 'session.sideChatStart', {}))
    expect(opened).toMatchObject({ ok: true, sessionId: 'side' })
    expect(store.rows.has('side')).toBe(false)
    await runWindowControl(7, () => host.sendSessionMessage('local', { sessionId: 'side', text: 'aside' }))
    expect(await runWindowControl(7, () => host.callSession('local', 'side', 'session.sideChatClose', {}))).toBe(true)
    expect(sessions.getSession('side')).toBeNull()
    expect(sessions.getSession('own')).toBe(own)
  })

  it('does not advertise side chats when the host has no implementation', () => {
    expect(localRoute().domain.localSessions.servedOperations.has('session.sideChatStart')).toBe(false)
  })
})

describe('scheduled sends on the local environment endpoint', () => {
  it('reads without control and fences changes on the named session', async () => {
    const bySession = new Map<string, import('@superone/shared/agent-types').ScheduledSend>()
    const { host, own } = localRoute({ scheduledSends: {
      get: (id) => bySession.get(id) ?? null,
      list: () => [...bySession.values()],
      set: (id, patch) => {
        own.lease.assertMutation()
        const row = { sessionId: id, sendAt: Date.now() + 60_000, armed: false, source: 'manual' as const, message: null, ...patch }
        bySession.set(id, row); return row
      },
      clear: (id) => { own.lease.assertMutation(); bySession.delete(id) },
    } })
    expect(await host.callSession('local', 'own', 'session.scheduledSend.get', {})).toBeNull()
    await runWindowControl(7, () => host.callSession('local', 'own', 'session.scheduledSend.set', { patch: { armed: true, message: 'later' } }))
    expect(await host.callSessionList('local', 'sessionList.scheduledSends', {})).toMatchObject([{ sessionId: 'own', message: 'later' }])
    await expect(runWindowControl(7, () => host.callSession('local', 'own', 'session.scheduledSend.set', { patch: { sendAt: NaN } }))).rejects.toMatchObject({ code: 'invalid_argument' })
    await expect(host.callSession('local', 'own', 'session.scheduledSend.clear', {})).rejects.toThrow('local session control needs a window')
    await runWindowControl(7, () => host.callSession('local', 'own', 'session.scheduledSend.clear', {}))
    expect(await host.callSessionList('local', 'sessionList.scheduledSends', {})).toEqual([])
  })
})

describe('session housekeeping on the local environment endpoint', () => {
  it('deletes only old unpinned sessions after disposing them', async () => {
    const { host, store, sessions, projectDir } = localRoute()
    store.rows.set('own', { ...store.rows.get('own')!, updatedAt: 0 })
    store.createRow({ sessionId: 'pinned', projectPath: projectDir, cwd: projectDir })
    store.rows.set('pinned', { ...store.rows.get('pinned')!, updatedAt: 0, isPinned: true })
    store.createRow({ sessionId: 'recent', projectPath: projectDir, cwd: projectDir })
    const deleted = await runWindowControl(7, () => host.callSessionList('local', 'sessionList.deleteOlderThan', { projectId: 'p1', cutoffDate: '2000-01-01' }))
    expect(deleted).toEqual(['own'])
    expect(sessions.getSession('own')).toBeNull()
    expect([...store.rows.keys()].sort()).toEqual(['pinned', 'recent'])
  })

  it('refuses the batch before deleting anything if a phone owns a candidate', async () => {
    const { host, domain, store, projectDir } = localRoute()
    store.rows.set('own', { ...store.rows.get('own')!, updatedAt: 0 })
    store.createRow({ sessionId: 'other', projectPath: projectDir, cwd: projectDir })
    store.rows.set('other', { ...store.rows.get('other')!, updatedAt: 0 })
    const phone = await connectPhone(domain, { deviceId: 'a' }); cleanup.push(phone.close)
    await phone.rpc('session.acquireControl', { sessionId: 'own' })
    await expect(runWindowControl(7, () => host.callSessionList('local', 'sessionList.deleteOlderThan', { projectId: 'p1', cutoffDate: '2000-01-01' }))).rejects.toMatchObject({ code: 'failed_precondition' })
    expect(store.rows.size).toBe(2)
  })
})
