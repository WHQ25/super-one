import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { EnvironmentEventEnvelope } from '@superone/shared/environment'

const state = vi.hoisted(() => ({
  grants: new Map<string, { grant_id: string; child_session_id: string; config_json: string }>(),
  events: [] as EnvironmentEventEnvelope[],
  status: 'idle',
  connected: true,
}))

vi.mock('../logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() } }))
vi.mock('./collaboration-mailbox', () => ({
  collaborationStore: () => ({
    startedSpawnGrants: () => [...state.grants.values()],
    grantById: (id: string) => state.grants.get(id) ?? null,
    updateConfig: (id: string, config: object) => {
      const grant = state.grants.get(id)!
      state.grants.set(id, { ...grant, config_json: JSON.stringify(config) })
    },
  }),
}))
vi.mock('./collaboration-remote', () => ({
  remotePort: async () => ({
    listEnvironments: async () => [{ environmentId: 'env-b', connectionId: 'conn-b', label: 'B', connected: state.connected, harnessIds: [] }],
    getSession: async () => ({ status: state.status, pendingInteraction: null }),
    listEvents: async (_c: string, after: string) => state.events.filter((e) => BigInt(e.sequence) > BigInt(after)),
  }),
}))

const { RemoteChildWatcher } = await import('./collaboration-remote-watch')

function statusEvent(sequence: number, status: string, sessionId = 'child'): EnvironmentEventEnvelope {
  return {
    sequence: String(sequence),
    aggregateType: 'session',
    aggregateId: sessionId,
    eventType: 'session.agent_event',
    eventId: `e${sequence}`,
    timestamp: 1_000 + sequence,
    payload: { event: { type: 'status_change', status } },
  } as unknown as EnvironmentEventEnvelope
}

function cursorOf() {
  return JSON.parse(state.grants.get('g1')!.config_json).remote as { eventCursor: string; runOpen: boolean }
}

describe('RemoteChildWatcher', () => {
  let fed: Array<{ sessionId: string; status?: string }>
  let resumed: string[]
  const feed = {
    handleEvent: (sessionId: string, event: AgentEvent) => {
      fed.push({ sessionId, status: event.type === 'status_change' ? event.status : undefined })
    },
    resumeRun: (sessionId: string) => { resumed.push(sessionId) },
  }

  beforeEach(() => {
    fed = []
    resumed = []
    state.connected = true
    state.status = 'idle'
    state.events = [statusEvent(10, 'streaming', 'other'), statusEvent(11, 'streaming')]
    state.grants = new Map([['g1', {
      grant_id: 'g1',
      child_session_id: 'child',
      config_json: JSON.stringify({ remote: { environmentId: 'env-b', label: 'B', eventCursor: '5' } }),
    }]])
  })

  it('feeds a child run from its persisted cursor and records how far it got', async () => {
    const watcher = new RemoteChildWatcher(feed)
    await watcher.tick()
    expect(fed).toEqual([{ sessionId: 'child', status: 'streaming' }])
    expect(cursorOf()).toEqual(expect.objectContaining({ eventCursor: '11', runOpen: true }))

    state.events.push(statusEvent(12, 'idle'))
    await watcher.tick()
    expect(fed.at(-1)).toEqual({ sessionId: 'child', status: 'idle' })
    expect(cursorOf()).toEqual(expect.objectContaining({ eventCursor: '12', runOpen: false }))
  })

  it('after a restart resumes the open run and sees its stop exactly once', async () => {
    await new RemoteChildWatcher(feed).tick()
    fed = []
    // This desktop restarts; the child stops meanwhile.
    state.events.push(statusEvent(12, 'idle'))
    const restarted = new RemoteChildWatcher(feed)
    await restarted.tick()
    expect(resumed).toEqual(['child'])
    expect(fed).toEqual([{ sessionId: 'child', status: 'idle' }])
    await restarted.tick()
    await new RemoteChildWatcher(feed).tick()
    expect(fed).toHaveLength(1)
  })

  it('waits for the machine to reconnect and reads the run state again then', async () => {
    state.connected = false
    const watcher = new RemoteChildWatcher(feed)
    await watcher.tick()
    expect(fed).toEqual([])
    state.connected = true
    state.status = 'streaming'
    state.events = []
    await watcher.tick()
    expect(resumed).toEqual(['child'])
  })
})
