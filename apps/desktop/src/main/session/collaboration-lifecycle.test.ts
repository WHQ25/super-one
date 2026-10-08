import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, AgentStatus, ChatMessage } from '@superone/shared/agent-types'
import type { Session, SessionManager } from './types'

const state = vi.hoisted(() => ({
  parents: new Map<string, string>(),
  times: new Map<string, { sentAt: string | null; receivedAt: string | null }>(),
  wake: vi.fn(async () => {}),
}))

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }))
vi.mock('./collaboration-mailbox', () => ({
  spawnParentOf: (id: string) => state.parents.get(id) ?? null,
  collaborationStore: () => ({
    lastMessageTimes: (id: string) => state.times.get(id) ?? { sentAt: null, receivedAt: null },
  }),
}))
vi.mock('./collaboration-host', () => ({ wakeParentOfStoppedChild: state.wake }))

const {
  CHILD_STALL_MS,
  CollaborationChildMonitor,
  describeChildStatus,
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

describe('CollaborationChildMonitor', () => {
  let child: FakeChild
  let notifyStalled: ReturnType<typeof vi.fn>
  let clearStalled: ReturnType<typeof vi.fn>
  let monitor: InstanceType<typeof CollaborationChildMonitor>

  beforeEach(() => {
    state.parents = new Map([['child', 'parent']])
    state.times = new Map()
    state.wake.mockClear()
    child = { status: 'streaming', pending: [], activityAt: 1_000, lastUserMessageAt: 1_000, messages: [] }
    notifyStalled = vi.fn()
    clearStalled = vi.fn()
    const host = { getSession: (id: string) => (id === 'child' ? fakeSession(child) : null) } as unknown as SessionManager
    monitor = new CollaborationChildMonitor({ host, notifyStalled, clearStalled })
  })

  const feed = (event: AgentEvent, sessionId = 'child', replay = false) =>
    monitor.handleEvent(sessionId, event, replay)

  it('wakes the parent once when a child stops without reporting', () => {
    feed({ type: 'status_change', status: 'streaming' })
    feed({ type: 'status_change', status: 'idle' })
    feed({ type: 'status_change', status: 'idle' })
    expect(state.wake).toHaveBeenCalledTimes(1)
    expect(state.wake).toHaveBeenCalledWith(expect.anything(), 'parent', 'child', 'idle')
  })

  it('waits for background work to finish before treating the child as stopped', () => {
    feed({ type: 'status_change', status: 'streaming' })
    feed({ type: 'status_change', status: 'background' })
    expect(state.wake).not.toHaveBeenCalled()
    feed({ type: 'status_change', status: 'idle' })
    expect(state.wake).toHaveBeenCalledTimes(1)
  })

  it('does not wake when the child reported after its last input', () => {
    state.times.set('child', { sentAt: iso(2_000), receivedAt: null })
    feed({ type: 'status_change', status: 'streaming' })
    feed({ type: 'status_change', status: 'idle' })
    expect(state.wake).not.toHaveBeenCalled()
  })

  it('wakes when a mailbox delivery arrived after the last report', () => {
    state.times.set('child', { sentAt: iso(2_000), receivedAt: iso(3_000) })
    feed({ type: 'status_change', status: 'streaming' })
    feed({ type: 'status_change', status: 'idle' })
    expect(state.wake).toHaveBeenCalledTimes(1)
  })

  it('wakes nobody for a run a human stopped, a replay, or a non-spawn session', () => {
    feed({ type: 'status_change', status: 'streaming' })
    feed({ type: 'message_interrupted', messageId: 'm1' })
    feed({ type: 'status_change', status: 'idle' })
    feed({ type: 'status_change', status: 'streaming' }, 'child', true)
    feed({ type: 'status_change', status: 'idle' }, 'child', true)
    feed({ type: 'status_change', status: 'streaming' }, 'top-level')
    feed({ type: 'status_change', status: 'idle' }, 'top-level')
    expect(state.wake).not.toHaveBeenCalled()
  })

  it('names a quota failure in the wake status', () => {
    feed({ type: 'status_change', status: 'streaming' })
    feed({ type: 'message_error', messageId: 'm1', error: '429 Too Many Requests' })
    feed({ type: 'status_change', status: 'error' })
    expect(state.wake).toHaveBeenCalledWith(expect.anything(), 'parent', 'child', 'error: rate limited or out of quota')
  })

  it('notifies the human once per stall and withdraws it when activity resumes', () => {
    feed({ type: 'status_change', status: 'streaming' })
    const stalledAt = child.activityAt + CHILD_STALL_MS
    monitor.checkStalls(stalledAt - 1)
    expect(notifyStalled).not.toHaveBeenCalled()
    monitor.checkStalls(stalledAt)
    monitor.checkStalls(stalledAt + 60_000)
    expect(notifyStalled).toHaveBeenCalledTimes(1)
    expect(notifyStalled).toHaveBeenCalledWith('child')

    child.activityAt = stalledAt + 120_000
    feed({ type: 'status_change', status: 'streaming' })
    expect(clearStalled).toHaveBeenCalledWith('child')
    expect(state.wake).not.toHaveBeenCalled()
  })

  it('does not count a pending approval as a stall', () => {
    child.pending = [{ type: 'permission_request', request: { requestId: 'r', toolName: 'Bash', input: {} } } as AgentEvent]
    feed({ type: 'status_change', status: 'streaming' })
    monitor.checkStalls(child.activityAt + CHILD_STALL_MS)
    expect(notifyStalled).not.toHaveBeenCalled()
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
})
