/**
 * What a turn tells the harness about itself: who wrote it (Claude stamps only
 * the user's own text as human-typed) and the client's Ultracode toggle.
 */
import { describe, expect, it } from 'vitest'
import {
  SessionRuntime,
  type NodeSessionRecord,
  type SessionStore,
  type TurnRunner,
} from './session-runtime'

type RunnerInput = Parameters<TurnRunner>[0]

function runtimeWith(inputs: RunnerInput[]) {
  const rows = new Map<string, NodeSessionRecord>()
  const store: SessionStore = {
    loadAll: () => [...rows.values()],
    save: (s) => { rows.set(s.sessionId, s) },
    delete: (id) => { rows.delete(id) },
  }
  const runner: TurnRunner = async (input) => {
    inputs.push(input)
    return { finalText: '', providerResume: null }
  }
  return new SessionRuntime(
    store,
    { headSequence: () => '0',
    epoch: 'test', streamingAfter: () => [], streaming: () => [], onAppend: () => () => {}, listAfter: () => [], appendSession: () => {} },
    { assertValid: () => {} },
    'env-source',
    runner,
  )
}

const control = { client: { clientSessionId: 'c1' }, leaseId: 'l1', generation: 'g1' }

describe('SessionRuntime turn source', () => {
  it('sends a client turn as the user\'s own, with its Ultracode toggle', async () => {
    const inputs: RunnerInput[] = []
    const runtime = runtimeWith(inputs)
    const { sessionId } = runtime.create({ projectId: 'p', harnessId: 'claude' })

    await runtime.send({ sessionId, text: 'ultracode the refactor', ultracode: true, ...control })
    await runtime.send({ sessionId, text: 'next', ...control })

    expect(inputs.map(({ source, ultracode }) => ({ source, ultracode }))).toEqual([
      { source: undefined, ultracode: true },
      { source: undefined, ultracode: undefined },
    ])
  })

  it('keeps a peer\'s task and a host wake apart from the user\'s text', async () => {
    const inputs: RunnerInput[] = []
    const runtime = runtimeWith(inputs)
    const { sessionId } = runtime.create({ projectId: 'p', harnessId: 'claude' })

    await runtime.sendWithoutLease({ sessionId, text: 'parent task', source: 'collaboration' })
    await runtime.sendWithoutLease({ sessionId, text: 'peer wake', source: 'task-notification' })
    await runtime.sendWithoutLease({ sessionId, text: 'automation prompt' })

    expect(inputs.map((input) => input.source)).toEqual(['collaboration', 'task-notification', undefined])
  })
})
