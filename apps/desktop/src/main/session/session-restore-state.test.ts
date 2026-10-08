import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent, SendMessageRequest } from '@superone/shared/agent-types'
import { ChatRuntime } from '../../../../mobile/src/runtime'
import { buildRemoteSessionSnapshot } from '../agent/remote-session-snapshot'
import { Session } from './session'
import type { SessionBackend } from './types'

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))
vi.mock('./realtime-timeline-repo', () => ({ loadRealtimeTimeline: () => null }))
vi.mock('../environment/session-identity', () => ({ localSessionEnvironmentId: () => 'desktop' }))

function fixture() {
  let emit!: (event: AgentEvent) => void
  const backend = {
    kind: 'codex', start: vi.fn(async () => {}), send: vi.fn(async (_request: SendMessageRequest) => {}),
    onEvent: (listener: typeof emit) => { emit = listener; return () => {} },
    onProviderSessionId: () => () => {}, onPermissionModeApplied: () => () => {},
  }
  const session = new Session({ id: 'session', projectPath: '/project', cwd: '/project',
    providerId: 'codex', harnessId: 'codex', providerConfig: {}, backend: backend as unknown as SessionBackend })
  return { session, emit: (event: AgentEvent) => emit(event) }
}

/** The phone's restore: subscribe answers with the snapshot, the host's replay is the first buffered batch. */
async function openOnMobile(session: Session) {
  const client = {
    startBuffering() {}, releaseBuffer: () => ({ epoch: 1, batches: [session.getReplayEvents()] }),
    async request(command: { type: string }) {
      if (command.type !== 'subscribe_session') return { ok: true }
      return {
        historyPage: { messages: [], provider: 'codex', hasMore: false },
        snapshot: await buildRemoteSessionSnapshot(session, '/project', 'session'),
      }
    },
  }
  const runtime = new ChatRuntime(client as never, () => {})
  await runtime.open('/project', 'session')
  return runtime
}

describe('session state that only events carry', () => {
  it('restores the goal the phone missed while it was away, including a cleared one', async () => {
    const { session, emit } = fixture()
    expect((await buildRemoteSessionSnapshot(session, '/project', 'session')).goal).toBeNull()

    emit({ type: 'session_goal', goal: { objective: 'ship it', status: 'paused' } })
    expect((await buildRemoteSessionSnapshot(session, '/project', 'session')).goal).toEqual({ objective: 'ship it', status: 'paused' })
    expect((await openOnMobile(session)).session.sessionGoal).toEqual({ objective: 'ship it', status: 'paused' })

    emit({ type: 'session_goal', goal: null })
    expect((await buildRemoteSessionSnapshot(session, '/project', 'session')).goal).toBeNull()
    expect((await openOnMobile(session)).session.sessionGoal).toBeNull()
  })

  it('replays the goal and the harness todo list to a subscriber that arrives later', async () => {
    const { session, emit } = fixture()
    const todos = [{ id: '1', subject: 'Write the test', description: '', status: 'in_progress' as const }]
    emit({ type: 'session_goal', goal: { objective: 'ship it', status: 'active' } })
    emit({ type: 'todos_updated', todos })

    const late: AgentEvent[] = []
    session.on((event) => late.push(event))
    expect(late).toContainEqual(expect.objectContaining({ type: 'session_goal', goal: { objective: 'ship it', status: 'active' } }))
    expect(late).toContainEqual(expect.objectContaining({ type: 'todos_updated', todos }))

    const runtime = await openOnMobile(session)
    expect(runtime.todos).toEqual({ 1: todos[0] })
    expect(runtime.session.sessionGoal).toEqual({ objective: 'ship it', status: 'active' })
  })
})
