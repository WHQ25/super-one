import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openNodeDatabase } from '@superone/runtime/db'
import { CollaborationStore } from '@superone/runtime/collaboration'
import type { EnvironmentEventEnvelope } from '@superone/shared/environment'
import type { SessionManager } from './types'

const state = vi.hoisted(() => ({
  store: null as unknown as CollaborationStore,
  events: [] as EnvironmentEventEnvelope[],
  status: 'idle',
  connected: true,
  wake: vi.fn(async (..._args: unknown[]) => {}),
  /** Events of the second machine, `env-c`. */
  eventsC: [] as EnvironmentEventEnvelope[],
}))

vi.mock('../logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() } }))
vi.mock('./collaboration-mailbox', () => ({
  collaborationStore: () => state.store,
  spawnParentOf: (id: string) => state.store.spawnGrantForChild(id)?.parent_session_id ?? null,
}))
vi.mock('./collaboration-host', () => ({ wakeParentOfStoppedChild: state.wake }))
vi.mock('./collaboration-remote', () => ({
  remoteChildTarget: () => ({ environmentId: 'env-b' }),
  remoteChildState: async () => ({ status: state.status, pendingInteraction: null }),
  remotePort: async () => ({
    listEnvironments: async () => [
      { environmentId: 'env-b', connectionId: 'conn-b', label: 'B', connected: state.connected, harnessIds: [] },
      { environmentId: 'env-c', connectionId: 'conn-c', label: 'C', connected: true, harnessIds: [] },
    ],
    getSession: async () => ({ status: state.status, pendingInteraction: null }),
    listEvents: async (connectionId: string, after: string) =>
      (connectionId === 'conn-c' ? state.eventsC : state.events).filter((e) => BigInt(e.sequence) > BigInt(after)).slice(0, 1000),
  }),
}))

const { RemoteChildWatcher } = await import('./collaboration-remote-watch')
const { CollaborationChildMonitor } = await import('./collaboration-lifecycle')

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function envelope(sequence: number, eventType: string, payload: unknown, sessionId = 'child'): EnvironmentEventEnvelope {
  return {
    sequence: String(sequence),
    aggregateType: 'session',
    aggregateId: sessionId,
    eventType,
    eventId: `e${sequence}`,
    timestamp: 1_000 + sequence,
    payload,
  } as unknown as EnvironmentEventEnvelope
}

const agentEvent = (sequence: number, event: object, sessionId = 'child') =>
  envelope(sequence, 'session.agent_event', { event }, sessionId)
const statusEvent = (sequence: number, status: string, sessionId = 'child') =>
  agentEvent(sequence, { type: 'status_change', status }, sessionId)

let grantId: string

function remoteOf() {
  return JSON.parse(state.store.grantById(grantId)!.config_json).remote as { eventCursor: string; run?: object }
}

/** This desktop as it starts: a fresh monitor and watcher over the persisted grants. */
function startDesktop(now = Date.now) {
  const monitor = new CollaborationChildMonitor({
    host: { getSession: () => null } as unknown as SessionManager,
    now,
    view: () => null,
    lastUserMessageAt: () => null,
    notifyStalled: vi.fn(),
    clearStalled: vi.fn(),
  })
  return { monitor, watcher: new RemoteChildWatcher(monitor) }
}

async function tick(desktop: ReturnType<typeof startDesktop>) {
  await desktop.watcher.tick()
  await settle()
}

describe('RemoteChildWatcher', () => {
  beforeEach(() => {
    state.connected = true
    state.status = 'idle'
    state.wake.mockClear()
    state.eventsC = []
    state.events = [statusEvent(10, 'streaming', 'other'), statusEvent(11, 'streaming')]
    state.store = new CollaborationStore(openNodeDatabase(':memory:'))
    grantId = state.store.createGrant({
      kind: 'spawn',
      parentSessionId: 'parent',
      agentId: 'claude',
      config: { launchId: 'l1', remote: { environmentId: 'env-b', label: 'B', eventCursor: '5' } },
    })
    state.store.bindStartedSession(state.store.grantById(grantId)!, 'child', JSON.parse(state.store.grantById(grantId)!.config_json))
    state.store.markTaskSent(grantId)
  })

  it('feeds a child run from its persisted cursor and records the run open there', async () => {
    const desktop = startDesktop()
    await tick(desktop)
    expect(remoteOf()).toEqual(expect.objectContaining({ eventCursor: '11', run: { interrupted: false } }))

    state.events.push(statusEvent(12, 'idle'))
    await tick(desktop)
    expect(remoteOf().eventCursor).toBe('12')
    expect(remoteOf().run).toBeUndefined()
    expect(state.wake).toHaveBeenCalledTimes(1)
    expect(state.wake).toHaveBeenCalledWith(expect.anything(), 'parent', 'child', 'idle')
  })

  it('after a restart of this desktop resumes the open run and wakes for its stop exactly once', async () => {
    await tick(startDesktop())
    state.events.push(statusEvent(12, 'idle'))
    const restarted = startDesktop()
    await tick(restarted)
    await tick(restarted)
    await tick(startDesktop())
    expect(state.wake).toHaveBeenCalledTimes(1)
  })

  it('wakes nobody for a run a human stopped, even across a restart and many pages of events', async () => {
    state.events.push(agentEvent(12, { type: 'message_interrupted', messageId: 'm1' }))
    for (let sequence = 13; sequence < 2_600; sequence++) state.events.push(statusEvent(sequence, 'streaming', 'other'))
    await tick(startDesktop())
    expect(remoteOf()).toEqual(expect.objectContaining({ eventCursor: '2599', run: { interrupted: true } }))

    state.events.push(statusEvent(2_600, 'idle'))
    await tick(startDesktop())
    expect(remoteOf().eventCursor).toBe('2600')
    expect(state.wake).not.toHaveBeenCalled()
  })

  it('wakes the parent when the child machine restarted mid-run', async () => {
    const desktop = startDesktop()
    await tick(desktop)
    state.events.push(envelope(12, 'session.reconciled', { status: 'interrupted', reason: 'node_restart_non_reattachable' }))
    await tick(desktop)
    expect(state.wake).toHaveBeenCalledWith(expect.anything(), 'parent', 'child', 'interrupted (its machine restarted)')
    expect(remoteOf().run).toBeUndefined()
  })

  it('wakes once when both machines restarted during the run', async () => {
    await tick(startDesktop())
    state.events.push(envelope(12, 'session.reconciled', { status: 'interrupted', reason: 'node_restart' }))
    await tick(startDesktop())
    await tick(startDesktop())
    expect(state.wake).toHaveBeenCalledTimes(1)
  })

  it('ends a resumed run the node settled without logging a stop', async () => {
    await tick(startDesktop())
    // An older node: the run ended in its restart and nothing says so in its log.
    state.status = 'interrupted'
    await tick(startDesktop())
    expect(state.wake).toHaveBeenCalledWith(expect.anything(), 'parent', 'child', 'interrupted')
    expect(remoteOf().run).toBeUndefined()
  })

  it('keeps a stop wake the parent never saw and sends it again after a restart', async () => {
    await tick(startDesktop())
    // This desktop dies before the wake reaches the parent.
    state.wake.mockImplementationOnce(() => new Promise(() => {}))
    state.events.push(statusEvent(12, 'idle'))
    await tick(startDesktop())
    expect(JSON.parse(state.store.grantById(grantId)!.config_json).pendingStopWake).toMatchObject({ key: '12', status: 'idle' })

    const restarted = startDesktop(() => Date.now() + 60_000)
    await tick(restarted)
    await restarted.monitor.resendStopWakes()
    expect(state.wake).toHaveBeenCalledTimes(2)
  })

  it('wakes for children on two machines that stop at the same event sequence', async () => {
    const other = state.store.createGrant({
      kind: 'spawn',
      parentSessionId: 'parent',
      agentId: 'claude',
      config: { launchId: 'l2', remote: { environmentId: 'env-c', label: 'C', eventCursor: '5' } },
    })
    state.store.bindStartedSession(state.store.grantById(other)!, 'child-c', JSON.parse(state.store.grantById(other)!.config_json))
    state.store.markTaskSent(other)
    state.eventsC = [statusEvent(11, 'streaming', 'child-c')]
    const desktop = startDesktop()
    await tick(desktop)
    state.events.push(statusEvent(12, 'idle'))
    state.eventsC.push(statusEvent(12, 'idle', 'child-c'))
    await tick(desktop)
    expect(state.wake.mock.calls.map((call) => call[2]).sort()).toEqual(['child', 'child-c'])
  })

  describe('a recorded stop the child moved past', () => {
    const pending = () => JSON.parse(state.store.grantById(grantId)!.config_json).pendingStopWake

    beforeEach(async () => {
      await tick(startDesktop())
      state.events.push(statusEvent(12, 'idle'))
      await tick(startDesktop())
      expect(pending()).toMatchObject({ key: '12' })
    })

    it('ends when this desktop restarts while the child runs again', async () => {
      state.events.push(statusEvent(13, 'streaming'))
      state.status = 'streaming'
      const restarted = startDesktop(() => Date.now() + 60_000)
      await tick(restarted)
      expect(pending()).toBeUndefined()
      await restarted.monitor.resendStopWakes()
      expect(state.wake).toHaveBeenCalledTimes(1)
    })

    it('ends when the new run already reported and stopped before this desktop is back', async () => {
      state.store.appendMessage({ grantId, senderSessionId: 'child', recipientSessionId: 'parent', content: 'done' })
      state.events.push(statusEvent(13, 'streaming'), statusEvent(14, 'idle'))
      const restarted = startDesktop(() => Date.now() + 60_000)
      await tick(restarted)
      expect(pending()).toBeUndefined()
      await restarted.monitor.resendStopWakes()
      expect(state.wake).toHaveBeenCalledTimes(1)
    })
  })

  it('waits for the machine to reconnect and reads the run state again then', async () => {
    state.connected = false
    const desktop = startDesktop()
    await tick(desktop)
    expect(remoteOf().eventCursor).toBe('5')
    state.connected = true
    state.status = 'streaming'
    state.events = []
    await tick(desktop)
    expect(desktop.monitor.runState('child')).toEqual({ interrupted: false })
  })
})
