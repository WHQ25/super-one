import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, AgentStatus, ChatMessage } from '@superone/shared/agent-types'
import { openNodeDatabase } from '@superone/runtime/db'
import { CollaborationStore } from '@superone/runtime/collaboration'
import type { Session, SessionManager, TaskNotificationDelivery } from './types'

const state = vi.hoisted(() => ({
  store: null as unknown as CollaborationStore,
  times: new Map<string, { sentAt: string | null; receivedAt: string | null }>(),
  wake: vi.fn(async (..._args: unknown[]): Promise<TaskNotificationDelivery> => 'accepted'),
  remote: new Map<string, { status: string; pendingInteraction: unknown } | null>(),
}))

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }))
vi.mock('./collaboration-mailbox', () => ({
  spawnParentOf: (id: string) => state.store.spawnGrantForChild(id)?.parent_session_id ?? null,
  collaborationStore: () => state.store,
}))
vi.mock('./collaboration-host', () => ({ wakeParentOfStoppedChild: state.wake }))
vi.mock('./collaboration-remote', () => ({
  remoteChildTarget: (id: string) => (state.remote.has(id) ? { environmentId: 'env-b' } : null),
  remoteChildState: async (id: string) => state.remote.get(id) ?? null,
}))

const {
  CHILD_STALL_MS,
  CollaborationChildMonitor,
  childActivityView,
  describeChildStatus,
  describeCollaborationChild,
  localChildView,
} = await import('./collaboration-lifecycle')

interface FakeChild {
  status: AgentStatus
  pending: AgentEvent[]
  activityAt: number
  lastUserMessageAt: number | null
  messages: ChatMessage[]
}

function fakeSession(child: FakeChild): Session {
  return {
    activityStatus: () => child.status,
    getPendingInteractions: () => child.pending,
    get lastRuntimeActivityAt() { return child.activityAt },
    get snapshot() { return { lastUserMessageAt: child.lastUserMessageAt, messages: child.messages } },
  } as unknown as Session
}

const iso = (ms: number) => new Date(ms).toISOString()
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** A fresh grant table; message times come from `state.times`. */
function resetStore(): void {
  const store = new CollaborationStore(openNodeDatabase(':memory:'))
  state.store = Object.assign(Object.create(store) as CollaborationStore, {
    lastMessageTimes: (id: string) => state.times.get(id) ?? { sentAt: null, receivedAt: null },
  })
}

/** A spawn child of `parent` whose task arrived unless `taskSent` is false; returns the grant id. */
function spawnChild(child: string, parent = 'parent', taskSent = true): string {
  const grantId = state.store.createGrant({ kind: 'spawn', parentSessionId: parent, agentId: 'claude', config: { launchId: child } })
  state.store.bindStartedSession(state.store.grantById(grantId)!, child, {})
  if (taskSent) state.store.markTaskSent(grantId)
  return grantId
}

function pendingWake(grantId: string): unknown {
  return JSON.parse(state.store.grantById(grantId)!.config_json).pendingStopWake
}

describe('CollaborationChildMonitor', () => {
  let child: FakeChild
  let notifyStalled: ReturnType<typeof vi.fn>
  let clearStalled: ReturnType<typeof vi.fn>
  let monitor: InstanceType<typeof CollaborationChildMonitor>

  let now: number

  beforeEach(() => {
    resetStore()
    spawnChild('child')
    state.times = new Map()
    state.remote = new Map()
    state.wake.mockReset()
    state.wake.mockResolvedValue('accepted')
    child = { status: 'streaming', pending: [], activityAt: 1_000, lastUserMessageAt: 1_000, messages: [] }
    notifyStalled = vi.fn()
    clearStalled = vi.fn()
    now = 1_000
    const host = { getSession: (id: string) => (id === 'child' ? fakeSession(child) : null) } as unknown as SessionManager
    monitor = new CollaborationChildMonitor({
      host,
      view: (id) => childActivityView(host, id).then((view) => (view === 'unreachable' ? null : view)),
      lastUserMessageAt: (id) => (id === 'child' ? child.lastUserMessageAt : null),
      notifyStalled,
      clearStalled,
      now: () => now,
    })
  })

  const feed = (event: AgentEvent, sessionId = 'child', replay = false) =>
    monitor.handleEvent(sessionId, event, replay)

  it('wakes the parent once when a child stops without reporting', async () => {
    feed({ type: 'status_change', status: 'streaming' })
    feed({ type: 'status_change', status: 'idle' })
    feed({ type: 'status_change', status: 'idle' })
    await settle()
    expect(state.wake).toHaveBeenCalledTimes(1)
    expect(state.wake).toHaveBeenCalledWith(expect.anything(), 'parent', 'child', 'idle')
  })

  it('waits for background work to finish before treating the child as stopped', async () => {
    feed({ type: 'status_change', status: 'streaming' })
    feed({ type: 'status_change', status: 'background' })
    await settle()
    expect(state.wake).not.toHaveBeenCalled()
    feed({ type: 'status_change', status: 'idle' })
    await settle()
    expect(state.wake).toHaveBeenCalledTimes(1)
  })

  it('does not wake when the child reported after its last input', async () => {
    state.times.set('child', { sentAt: iso(2_000), receivedAt: null })
    feed({ type: 'status_change', status: 'streaming' })
    feed({ type: 'status_change', status: 'idle' })
    await settle()
    expect(state.wake).not.toHaveBeenCalled()
  })

  it('wakes when a mailbox delivery arrived after the last report', async () => {
    state.times.set('child', { sentAt: iso(2_000), receivedAt: iso(3_000) })
    feed({ type: 'status_change', status: 'streaming' })
    feed({ type: 'status_change', status: 'idle' })
    await settle()
    expect(state.wake).toHaveBeenCalledTimes(1)
  })

  it('wakes nobody for a run a human stopped, a replay, or a non-spawn session', async () => {
    feed({ type: 'status_change', status: 'streaming' })
    feed({ type: 'message_interrupted', messageId: 'm1' })
    feed({ type: 'status_change', status: 'idle' })
    feed({ type: 'status_change', status: 'streaming' }, 'child', true)
    feed({ type: 'status_change', status: 'idle' }, 'child', true)
    feed({ type: 'status_change', status: 'streaming' }, 'top-level')
    feed({ type: 'status_change', status: 'idle' }, 'top-level')
    await settle()
    expect(state.wake).not.toHaveBeenCalled()
  })

  it('names a quota failure in the wake status', async () => {
    feed({ type: 'status_change', status: 'streaming' })
    feed({ type: 'message_error', messageId: 'm1', error: '429 Too Many Requests' })
    feed({ type: 'status_change', status: 'error' })
    await settle()
    expect(state.wake).toHaveBeenCalledWith(expect.anything(), 'parent', 'child', 'error: rate limited or out of quota')
  })

  it('does not wake when the initial task never reached the child', async () => {
    // session_collab_start already returned the delivery error to the parent.
    resetStore()
    spawnChild('child', 'parent', false)
    feed({ type: 'status_change', status: 'streaming' })
    feed({ type: 'message_error', messageId: 'm1', error: 'spawn failed' })
    feed({ type: 'status_change', status: 'error' })
    await settle()
    expect(state.wake).not.toHaveBeenCalled()
  })

  it('keeps the wake recorded until the parent accepts it and retries after a failure', async () => {
    const grantId = state.store.spawnGrantForChild('child')!.grant_id
    // The parent's harness fails to start once.
    state.wake.mockResolvedValueOnce('failed')
    feed({ type: 'status_change', status: 'streaming' })
    feed({ type: 'status_change', status: 'idle' })
    expect(pendingWake(grantId)).toEqual({ key: expect.any(String), status: 'idle' })
    await settle()
    expect(state.wake).toHaveBeenCalledTimes(1)
    expect(pendingWake(grantId)).toBeDefined()

    await monitor.retryStopWakes()
    expect(state.wake).toHaveBeenCalledTimes(2)
    expect(pendingWake(grantId)).toBeUndefined()
    await monitor.retryStopWakes()
    expect(state.wake).toHaveBeenCalledTimes(2)
  })

  it('delivers a wake recorded before a crash once this desktop is back', async () => {
    const grantId = state.store.spawnGrantForChild('child')!.grant_id
    // The process dies before the delivery runs.
    state.wake.mockImplementationOnce(() => new Promise(() => {}))
    feed({ type: 'status_change', status: 'streaming' })
    feed({ type: 'status_change', status: 'idle' })
    await settle()

    const restarted = new CollaborationChildMonitor({
      host: {} as SessionManager, view: () => null, lastUserMessageAt: () => null, notifyStalled, clearStalled,
    })
    await restarted.retryStopWakes()
    expect(state.wake).toHaveBeenLastCalledWith(expect.anything(), 'parent', 'child', 'idle')
    expect(pendingWake(grantId)).toBeUndefined()
  })

  it('does not retry a wake the parent queued until this desktop restarts', async () => {
    const grantId = state.store.spawnGrantForChild('child')!.grant_id
    state.wake.mockResolvedValueOnce('deferred')
    feed({ type: 'status_change', status: 'streaming' })
    feed({ type: 'status_change', status: 'idle' })
    await settle()
    await monitor.retryStopWakes()
    expect(state.wake).toHaveBeenCalledTimes(1)
    // The queue lived in this process only.
    expect(pendingWake(grantId)).toBeDefined()
  })

  it('notifies the human once per stall and withdraws it when activity resumes', async () => {
    feed({ type: 'status_change', status: 'streaming' })
    const stalledAt = child.activityAt + CHILD_STALL_MS
    await monitor.checkStalls(stalledAt - 1)
    expect(notifyStalled).not.toHaveBeenCalled()
    await monitor.checkStalls(stalledAt)
    await monitor.checkStalls(stalledAt + 60_000)
    expect(notifyStalled).toHaveBeenCalledTimes(1)
    expect(notifyStalled).toHaveBeenCalledWith('child')

    child.activityAt = stalledAt + 120_000
    feed({ type: 'status_change', status: 'streaming' })
    expect(clearStalled).toHaveBeenCalledWith('child')
    expect(state.wake).not.toHaveBeenCalled()
  })

  it('does not count a pending approval as a stall', async () => {
    child.pending = [{ type: 'permission_request', request: { requestId: 'r', toolName: 'Bash', input: {} } } as AgentEvent]
    feed({ type: 'status_change', status: 'streaming' })
    await monitor.checkStalls(child.activityAt + CHILD_STALL_MS)
    expect(notifyStalled).not.toHaveBeenCalled()
  })

  describe('a child on another machine', () => {
    beforeEach(() => {
      spawnChild('remote-child')
      state.remote.set('remote-child', { status: 'streaming', pendingInteraction: null })
    })

    it('wakes the parent when its drained events show it stopped without reporting', async () => {
      feed({ type: 'status_change', status: 'streaming' }, 'remote-child')
      feed({ type: 'status_change', status: 'idle' }, 'remote-child')
      await settle()
      expect(state.wake).toHaveBeenCalledWith(expect.anything(), 'parent', 'remote-child', 'idle')
    })

    it('notifies the human when no event arrived for the stall window while its node reports it streaming', async () => {
      feed({ type: 'status_change', status: 'streaming' }, 'remote-child')
      await monitor.checkStalls(1_000 + CHILD_STALL_MS - 1)
      expect(notifyStalled).not.toHaveBeenCalled()
      await monitor.checkStalls(1_000 + CHILD_STALL_MS)
      expect(notifyStalled).toHaveBeenCalledWith('remote-child')
      expect(state.wake).not.toHaveBeenCalled()
    })

    it('does not call a remote child waiting on approval stalled', async () => {
      state.remote.set('remote-child', { status: 'streaming', pendingInteraction: { interactionId: 'i1' } })
      feed({ type: 'status_change', status: 'streaming' }, 'remote-child')
      await monitor.checkStalls(1_000 + CHILD_STALL_MS)
      expect(notifyStalled).not.toHaveBeenCalled()
    })
  })
})

describe('describeChildStatus', () => {
  const toolMessage = {
    id: 'a1',
    role: 'assistant',
    content: [
      { type: 'tool_use', toolName: 'Read', toolUseId: 't1', input: '{}' },
      { type: 'tool_result', toolUseId: 't1', summary: 'ok' },
      { type: 'tool_use', toolName: 'Bash', toolUseId: 't2', input: '{}' },
      { type: 'tool_use', toolName: 'Grep', toolUseId: 't3', input: '{}', parentToolUseId: 't2' },
    ],
  } as unknown as ChatMessage

  it('reports a running child with its unfinished top-level tool', () => {
    const child: FakeChild = { status: 'streaming', pending: [], activityAt: 5_000, lastUserMessageAt: null, messages: [toolMessage] }
    expect(describeChildStatus(fakeSession(child), 6_000)).toEqual({
      state: 'running',
      lastActivityAt: iso(5_000),
      runningTool: 'Bash',
    })
    expect(describeChildStatus(fakeSession(child), 5_000 + CHILD_STALL_MS).state).toBe('stalled')
  })

  it('reports settled children without a tool, and an unloaded child as idle', () => {
    const child: FakeChild = { status: 'error', pending: [], activityAt: 5_000, lastUserMessageAt: null, messages: [toolMessage] }
    expect(describeChildStatus(fakeSession(child), 6_000)).toEqual({ state: 'error', lastActivityAt: iso(5_000) })
    expect(describeChildStatus(null)).toEqual({ state: 'idle' })
  })

  it('reports a remote child from its node, and an unreachable one as such', async () => {
    const host = { getSession: () => null } as unknown as SessionManager
    state.remote = new Map([
      ['waiting', { status: 'streaming', pendingInteraction: { interactionId: 'i1' } }],
      ['done', { status: 'interrupted', pendingInteraction: null }],
      ['gone', null],
    ])
    expect((await describeCollaborationChild(host, 'waiting')).state).toBe('awaiting_approval')
    expect((await describeCollaborationChild(host, 'done')).state).toBe('idle')
    expect(await describeCollaborationChild(host, 'gone')).toEqual({ state: 'unreachable' })
    expect(localChildView(null)).toBeNull()
  })
})
