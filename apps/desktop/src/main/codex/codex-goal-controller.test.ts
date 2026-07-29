import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodexGoalStatus } from '@superone/shared/agent-types'
import type { CodexSession } from './codex-session'

const turnMocks = vi.hoisted(() => ({
  streamTurnEvents: vi.fn(),
  withThreadConnection: vi.fn(async (
    session: { connectionHandle: { connection: unknown }; threadId: string | null },
    _auth: unknown,
    _signal: unknown,
    _projectPath: string,
    _cwd: string,
    _permissionProfile: unknown,
    fn: (context: { connection: unknown; threadId: string; markMutationStarted: () => void }) => unknown,
  ) => fn({
    connection: session.connectionHandle.connection,
    threadId: session.threadId ?? 'thread-1',
    markMutationStarted: vi.fn(),
  })),
}))

vi.mock('./codex-turn', () => ({
  deriveFinalResponse: (items: Array<{ type: string; text?: string }>) => items.findLast((item) => item.type === 'agent_message')?.text ?? '',
  streamTurnEvents: turnMocks.streamTurnEvents,
  withThreadConnection: turnMocks.withThreadConnection,
}))

vi.mock('./app-server-connection', () => ({
  resolvePermissionProfile: vi.fn(() => ({
    permissionPreset: 'default',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    networkAccessEnabled: true,
  })),
}))

import { CodexGoalController } from './codex-goal-controller'

function goal(status: CodexGoalStatus = 'active') {
  return {
    threadId: 'thread-1',
    objective: 'Finish it',
    status,
    tokenBudget: null,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: 1,
    updatedAt: 1,
  }
}

function makeHarness(request: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>) {
  const connection = { request: vi.fn(request) }
  const session = {
    projectPath: '/project',
    permissionPreset: 'default',
    threadId: 'thread-1',
    threadReady: true,
    connectionHandle: { connection },
    runningController: null,
    activeTurnId: null,
    steerFn: null,
    interruptFn: null,
  } as unknown as CodexSession
  const onRunStart = vi.fn()
  const onRunComplete = vi.fn()
  const onRunError = vi.fn()
  const onIdle = vi.fn()
  const controller = new CodexGoalController({
    getSession: () => session,
    getAuth: () => ({ mode: 'auto' }),
    getCwd: () => '/project',
    getCurrentRun: () => null,
    getCallbacks: () => ({}),
    onRunStart,
    onRunComplete,
    onRunError,
    onIdle,
  })
  return { connection, session, controller, onRunStart, onRunComplete, onRunError, onIdle }
}

describe('CodexGoalController', () => {
  beforeEach(() => {
    turnMocks.streamTurnEvents.mockReset()
    turnMocks.withThreadConnection.mockClear()
  })

  it('sets the goal on the live session connection and consumes automatic turns until completion', async () => {
    let getCount = 0
    const harness = makeHarness(async (method, params) => {
      if (method === 'thread/goal/set') {
        expect(params).toEqual({ threadId: 'thread-1', objective: 'Finish it' })
        return { goal: goal() }
      }
      if (method === 'thread/goal/get') {
        getCount += 1
        return { goal: goal(getCount === 1 ? 'active' : 'complete') }
      }
      throw new Error(`Unexpected method: ${method}`)
    })
    turnMocks.streamTurnEvents.mockResolvedValue({
      threadId: 'thread-1',
      turnId: 'turn-1',
      usage: null,
      items: [{ id: 'message-1', type: 'agent_message', text: 'Done' }],
    })

    await expect(harness.controller.set('thread-1', '  Finish it  ')).resolves.toEqual(goal())
    await harness.controller.wait()

    expect(turnMocks.withThreadConnection).toHaveBeenCalledOnce()
    expect(turnMocks.streamTurnEvents).toHaveBeenCalledOnce()
    expect(harness.onRunStart).toHaveBeenCalledOnce()
    expect(harness.onRunComplete).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ threadId: 'thread-1', turnId: 'turn-1', finalResponse: 'Done' }),
      expect.any(Number),
    )
    expect(harness.onRunError).not.toHaveBeenCalled()
    expect(harness.onIdle).toHaveBeenCalledOnce()
  })

  it('waits for the current explicit turn before consuming goal continuation events', async () => {
    let releaseCurrentRun: (() => void) | undefined
    const currentRun = new Promise<void>((resolve) => { releaseCurrentRun = resolve })
    let getCount = 0
    const harness = makeHarness(async (method) => {
      if (method === 'thread/goal/set') return { goal: goal() }
      getCount += 1
      return { goal: goal(getCount === 1 ? 'active' : 'complete') }
    })
    const controller = new CodexGoalController({
      getSession: () => harness.session,
      getAuth: () => ({ mode: 'auto' }),
      getCwd: () => '/project',
      getCurrentRun: () => currentRun,
      getCallbacks: () => ({}),
      onRunStart: harness.onRunStart,
      onRunComplete: harness.onRunComplete,
      onRunError: harness.onRunError,
      onIdle: harness.onIdle,
    })
    turnMocks.streamTurnEvents.mockResolvedValue({ threadId: 'thread-1', turnId: 'turn-1', usage: null, items: [] })

    await controller.set('thread-1', 'Finish it')
    await Promise.resolve()
    expect(turnMocks.streamTurnEvents).not.toHaveBeenCalled()

    releaseCurrentRun?.()
    await controller.wait()
    expect(turnMocks.streamTurnEvents).toHaveBeenCalledOnce()
  })

  it('keeps consuming while the app-server goal remains active after an interrupted turn', async () => {
    let getCount = 0
    const harness = makeHarness(async (method) => {
      if (method === 'thread/goal/set') return { goal: goal() }
      if (method === 'thread/goal/get') {
        getCount += 1
        return { goal: goal(getCount < 3 ? 'active' : 'complete') }
      }
      throw new Error(`Unexpected method: ${method}`)
    })
    turnMocks.streamTurnEvents
      .mockRejectedValueOnce(new Error('Codex run interrupted'))
      .mockResolvedValueOnce({
        threadId: 'thread-1',
        turnId: 'turn-2',
        usage: null,
        items: [{ id: 'message-2', type: 'agent_message', text: 'Done' }],
      })

    await harness.controller.set('thread-1', 'Finish it')
    await harness.controller.wait()

    expect(turnMocks.streamTurnEvents).toHaveBeenCalledTimes(2)
    expect(harness.onRunStart).toHaveBeenCalledTimes(2)
    expect(harness.onRunError).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ message: 'Codex run interrupted' }))
    expect(harness.onRunComplete).toHaveBeenCalledOnce()
  })

  it('gets and clears goals through the live session connection', async () => {
    const harness = makeHarness(async (method) => {
      if (method === 'thread/goal/get') return { goal: goal('complete') }
      if (method === 'thread/goal/clear') return { cleared: true }
      throw new Error(`Unexpected method: ${method}`)
    })

    await expect(harness.controller.get('thread-1')).resolves.toEqual(goal('complete'))
    await expect(harness.controller.clear('thread-1')).resolves.toBe(true)
    expect(turnMocks.streamTurnEvents).not.toHaveBeenCalled()
  })

  it('updates goal status without scheduling continuation while paused', async () => {
    const harness = makeHarness(async (method, params) => {
      expect(method).toBe('thread/goal/set')
      expect(params).toEqual({ threadId: 'thread-1', status: 'paused' })
      return { goal: goal('paused') }
    })

    await expect(harness.controller.pause()).resolves.toEqual(goal('paused'))
    expect(harness.controller.goal).toEqual(goal('paused'))
    expect(turnMocks.streamTurnEvents).not.toHaveBeenCalled()
  })

  it('includes an explicit status when updating the objective', async () => {
    const harness = makeHarness(async (method, params) => {
      expect(method).toBe('thread/goal/set')
      expect(params).toEqual({ threadId: 'thread-1', objective: 'Finish it', status: 'paused' })
      return { goal: goal('paused') }
    })

    await expect(harness.controller.set('thread-1', 'Finish it', 'paused')).resolves.toEqual(goal('paused'))
    expect(turnMocks.streamTurnEvents).not.toHaveBeenCalled()
  })

  it('reschedules an active goal updated while the previous consumer is finishing', async () => {
    let getCount = 0
    let finishTurn: (() => void) | undefined
    const turn = new Promise<void>((resolve) => { finishTurn = resolve })
    const harness = makeHarness(async (method) => {
      if (method === 'thread/goal/set') return { goal: goal('active') }
      getCount += 1
      if (getCount === 1) return { goal: goal('active') }
      if (getCount === 2) throw new Error('connection changed')
      return { goal: goal('complete') }
    })
    turnMocks.streamTurnEvents.mockImplementation(async () => {
      await turn
      return { threadId: 'thread-1', turnId: 'turn-1', usage: null, items: [] }
    })

    await harness.controller.set('thread-1', 'Finish it')
    await vi.waitFor(() => expect(turnMocks.streamTurnEvents).toHaveBeenCalledOnce())
    await harness.controller.setStatus('thread-1', 'active')
    finishTurn?.()
    await harness.controller.wait()
    await harness.controller.wait()

    expect(getCount).toBe(3)
  })

  it('rejects a thread id that does not match the live backend session', async () => {
    const harness = makeHarness(async () => ({ goal: null }))
    await expect(harness.controller.get('other-thread')).rejects.toThrow(/thread mismatch/)
    expect(harness.connection.request).not.toHaveBeenCalled()
  })
})
