import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import { SESSION_DURABLE_EVENT, type EnvironmentEventEnvelope } from '@superone/shared/environment'
import { nodeModClientId } from '@superone/shared/mod-ui'
import { SessionRuntime, type NodeSessionRecord, type SessionEventLog, type SessionStore, type TurnRunner } from './session-runtime'

const RECORD = {
  sessionId: 's1', projectId: 'p1', harnessId: 'claude', providerId: 'claude', title: null, status: 'idle', transcript: [],
  pendingInteraction: null, providerResume: null, cwd: null, permissionMode: null, sandboxMode: null, model: null, effort: null,
  apiProviderId: null, createdAt: 0, updatedAt: 0, isPinned: false, isHidden: false, isUserRenamed: false, tags: [],
  controllerClientSessionId: null, hostActionCapabilityVersion: 0, hostActionToolGroups: [], alwaysAllowedTools: [],
} as NodeSessionRecord

function runtime(modUi?: TurnRunner['modUi'], extra: Partial<TurnRunner> = {}, logged: EnvironmentEventEnvelope[] = []) {
  const store: SessionStore = { loadAll: () => [{ ...RECORD }], save: () => {}, delete: () => {} }
  const events: SessionEventLog = { headSequence: () => '0',
    epoch: 'test', streamingAfter: () => [], streaming: () => [], onAppend: () => () => {}, listAfter: () => logged, appendSession: () => {} }
  const assertValid = vi.fn()
  const runner = Object.assign((async () => ({ finalText: '' })) as TurnRunner, modUi ? { modUi } : {}, extra)
  return { rt: new SessionRuntime(store, events, { assertValid }, 'env', runner, { runtimeReaperIntervalMs: 0 }), assertValid }
}

function agentEvent(sequence: string, event: AgentEvent): EnvironmentEventEnvelope {
  return { eventId: sequence, sequence, timestamp: 0, aggregateType: 'session', aggregateId: 's1', eventType: SESSION_DURABLE_EVENT.agentEvent, eventVersion: 1, payload: { event }, environmentId: 'env' }
}

const client = { clientSessionId: 'c1' }

describe('SessionRuntime.modUi', () => {
  it('draws without the lease and checks it for ops that act on a plugin', async () => {
    const modUi = vi.fn(async () => ({ handled: true }))
    const { rt, assertValid } = runtime(modUi as unknown as TurnRunner['modUi'])
    await rt.modUi({ sessionId: 's1', op: 'panes', request: { clientId: 'x' }, client })
    expect(assertValid).not.toHaveBeenCalled()
    await rt.modUi({ sessionId: 's1', op: 'press', request: { plugin: 'p', handle: 1, surface: 'desktop', clientId: 'x' }, client, leaseId: 'l', generation: 'g' })
    expect(assertValid).toHaveBeenCalledWith(expect.objectContaining({ leaseId: 'l', generation: 'g', holderClientId: 'c1' }))
    expect(modUi).toHaveBeenCalledTimes(2)
  })

  it('rejects a lease failure before the runner sees the op', async () => {
    const modUi = vi.fn()
    const { rt, assertValid } = runtime(modUi as unknown as TurnRunner['modUi'])
    assertValid.mockImplementation(() => { throw Object.assign(new Error('stale'), { code: 'lease_stale' }) })
    await expect(rt.modUi({ sessionId: 's1', op: 'close', request: { id: 'a', clientId: 'x' }, client })).rejects.toMatchObject({ code: 'lease_stale' })
    expect(modUi).not.toHaveBeenCalled()
  })

  it('names a harness without mods and an unknown session apart', async () => {
    const { rt } = runtime()
    await expect(rt.modUi({ sessionId: 's1', op: 'panes', request: { clientId: 'x' }, client })).rejects.toMatchObject({ name: 'mod-ui-unavailable' })
    await expect(rt.modUi({ sessionId: 'nope', op: 'panes', request: { clientId: 'x' }, client })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('runs every op as the calling client, so one pairing cannot speak for another', async () => {
    const modUi = vi.fn(async () => ({ detached: true }))
    const { rt } = runtime(modUi as unknown as TurnRunner['modUi'])
    await rt.modUi({ sessionId: 's1', op: 'detach', request: { clientId: 'superone-desktop' }, client })
    await rt.modUi({ sessionId: 's1', op: 'hostReply', request: { requestId: 'r', clientId: 'superone-desktop', reply: { kind: 'copy', copied: true } }, client })
    expect(modUi.mock.calls.map((call) => (call as unknown[])[2])).toEqual([
      { clientId: nodeModClientId('superone-desktop', 'c1') },
      { requestId: 'r', clientId: nodeModClientId('superone-desktop', 'c1'), reply: { kind: 'copy', copied: true } },
    ])
  })
})

describe('SessionRuntime.listEventsAfter', () => {
  const mine = nodeModClientId('superone-desktop', 'c1')
  const theirs = nodeModClientId('superone-desktop', 'c2')
  const request = { kind: 'promptRead' } as const

  it('reads a host request only while it waits, and mod client ids as the reader\'s own', () => {
    const isModHostRequestPending = vi.fn((_sessionId: string, requestId: string) => requestId === 'live')
    const { rt } = runtime(undefined, { isModHostRequestPending }, [
      agentEvent('1', { type: 'mod_host_request', clientId: mine, requestId: 'stale', request }),
      agentEvent('2', { type: 'mod_host_request', clientId: mine, requestId: 'live', request }),
      agentEvent('3', { type: 'mod_focus', clientId: theirs, component: 'Pane', instanceId: 'i', plugin: 'p', key: 'k' }),
      agentEvent('4', { type: 'mod_invalidate' }),
    ])
    const read = rt.listEventsAfter('0', client)
    // The stale request's envelope stays, empty, so the reader's cursor moves past it.
    expect(read.map((e) => [e.sequence, (e.payload as { event?: AgentEvent }).event ?? null])).toEqual([
      ['1', null],
      ['2', { type: 'mod_host_request', clientId: 'superone-desktop', requestId: 'live', request }],
      ['3', { type: 'mod_focus', clientId: theirs, component: 'Pane', instanceId: 'i', plugin: 'p', key: 'k' }],
      ['4', { type: 'mod_invalidate' }],
    ])
    expect(isModHostRequestPending).toHaveBeenCalledWith('s1', 'stale')
  })
})
