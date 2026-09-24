import { beforeEach, describe, expect, it, vi } from 'vitest'
import { presentQuestions, type DeepseekQuestion } from '@superone/deepseek'
import type { AgentEvent, PermissionMode } from '@superone/shared/agent-types'
import type { BackendStartOptions } from '../types'

const { createAgentMock, setPlanModeMock } = vi.hoisted(() => ({
  createAgentMock: vi.fn(),
  setPlanModeMock: vi.fn(),
}))

vi.mock('../../logger', () => ({
  default: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

vi.mock('../../deepseek/deepseek-runtime-host', () => ({
  DEEPSEEK_DEFAULT_PROVIDER: 'deepseek-official',
  DEEPSEEK_DEFAULT_MODEL: 'deepseek-v4-pro',
  getDeepseekRuntime: async () => ({ createAgent: createAgentMock, setPermissionPreset: vi.fn(), setPlanMode: setPlanModeMock }),
  registerApprovalRouter: () => () => {},
}))

import { DeepseekBackend } from './deepseek-backend'

type AskUser = (question: DeepseekQuestion, signal?: AbortSignal) => Promise<unknown>

interface FakeAgent {
  askUser: AskUser
  emit: (event: AgentEvent) => void
  status: 'idle' | 'running'
  sent: string[]
  steered: string[]
}

function installFakeAgent(): FakeAgent {
  const state = { status: 'idle', sent: [], steered: [] } as unknown as FakeAgent
  createAgentMock.mockImplementation(async (options: {
    sessionId: string
    askUser: AskUser
    onEvent: (event: AgentEvent) => void
  }) => {
    state.askUser = options.askUser
    state.emit = options.onEvent
    return {
      sessionId: options.sessionId,
      sendText: async (text: string) => { state.sent.push(text) },
      steerText: async (text: string) => { state.steered.push(text) },
      setRoute: () => {},
      cancel: () => {},
      whenIdle: async () => {},
      status: () => state.status,
      dispose: async () => {},
    }
  })
  return state
}

async function startBackend(permissionMode: PermissionMode = 'default') {
  const agent = installFakeAgent()
  const backend = new DeepseekBackend()
  const events: AgentEvent[] = []
  const modes: PermissionMode[] = []
  backend.onEvent((event) => events.push(event))
  backend.onPermissionModeApplied((mode) => modes.push(mode))
  const opts: BackendStartOptions = {
    sessionId: 's1',
    projectPath: '/tmp/p',
    cwd: '/tmp/p',
    config: {},
    permissionMode,
    abortController: new AbortController(),
  }
  await backend.start(opts)
  return { agent, backend, events, modes }
}

const colorQuestion = presentQuestions([{
  id: 'q1',
  question: 'Which color?',
  options: [{ label: 'Red' }, { label: 'Blue' }],
}])

const planReview = presentQuestions([{
  id: 'plan-review',
  question: 'Approve this plan and leave plan mode?',
  detail: '# Ship it',
  options: [{ label: 'Approve' }, { label: 'Keep planning' }],
  intent: { kind: 'plan-review', approve: 'Approve' },
}])

function requestIdOf(events: AgentEvent[], type: 'ask_user_question' | 'plan_approval'): string {
  const event = events.find((candidate) => candidate.type === type)
  if (event?.type !== type) throw new Error(`no ${type} event`)
  return event.request.requestId
}

describe('DeepseekBackend questions', () => {
  beforeEach(() => {
    createAgentMock.mockReset()
    setPlanModeMock.mockReset()
  })

  it('shows ask_user_question on the question prompt and returns the answer to dsh', async () => {
    const { agent, backend, events } = await startBackend()

    const answer = agent.askUser(colorQuestion)
    const requestId = requestIdOf(events, 'ask_user_question')
    expect(backend.getPendingInteractions().map((event) => event.type)).toEqual(['ask_user_question'])
    backend.respondToQuestion(requestId, { 'Which color?': 'Blue' })

    await expect(answer).resolves.toEqual({ answers: [{ id: 'q1', selected: ['Blue'] }] })
    expect(events.at(-1)).toEqual({ type: 'interaction_resolved', interactionType: 'question', requestId })
    expect(backend.getPendingInteractions()).toEqual([])
  })

  it('reports a dismissed question, and one dsh withdrew, as dismissed', async () => {
    const { agent, backend, events } = await startBackend()

    const dismissed = agent.askUser(colorQuestion)
    backend.dismissQuestion(requestIdOf(events, 'ask_user_question'))
    const controller = new AbortController()
    const withdrawn = agent.askUser(colorQuestion, controller.signal)
    controller.abort()

    await expect(dismissed).resolves.toBe('dismissed')
    await expect(withdrawn).resolves.toBe('dismissed')
    expect(events.filter((event) => event.type === 'interaction_resolved')).toHaveLength(2)
  })

  it('shows a plan review as plan approval and leaves plan mode when it is approved', async () => {
    const { agent, backend, events, modes } = await startBackend('plan')
    expect(setPlanModeMock).toHaveBeenLastCalledWith(expect.any(String), true)

    const answer = agent.askUser(planReview)
    const approval = events.find((event) => event.type === 'plan_approval')
    expect(approval?.type === 'plan_approval' ? approval.request.planContent : null).toBe('# Ship it')
    backend.respondToPlanApproval(requestIdOf(events, 'plan_approval'), true)

    await expect(answer).resolves.toEqual({ answers: [{ id: 'plan-review', selected: ['Approve'] }] })
    await vi.waitFor(() => expect(modes).toEqual(['default']))
    expect(setPlanModeMock).toHaveBeenLastCalledWith(expect.any(String), false)
    expect(events).toContainEqual(expect.objectContaining({ type: 'interaction_resolved', interactionType: 'plan_approval', approved: true }))
  })

  it('stays in plan mode and returns the feedback when a plan is declined', async () => {
    const { agent, backend, events, modes } = await startBackend('plan')

    const answer = agent.askUser(planReview)
    backend.respondToPlanApproval(requestIdOf(events, 'plan_approval'), false, 'add tests')

    await expect(answer).resolves.toEqual({
      answers: [{ id: 'plan-review', selected: ['Keep planning'], custom: 'add tests' }],
    })
    expect(modes).toEqual([])
  })

  it('switches dsh plan mode with the session mode', async () => {
    const { backend } = await startBackend()
    expect(setPlanModeMock).toHaveBeenLastCalledWith(expect.any(String), false)

    await backend.setPermissionMode('plan')
    expect(setPlanModeMock).toHaveBeenLastCalledWith(expect.any(String), true)
    await backend.setPermissionMode('default')
    expect(setPlanModeMock).toHaveBeenLastCalledWith(expect.any(String), false)
  })

  it('dismisses open questions when the session closes', async () => {
    const { agent, backend } = await startBackend()

    const answer = agent.askUser(colorQuestion)
    await backend.close()

    await expect(answer).resolves.toBe('dismissed')
  })
})

describe('DeepseekBackend queued messages', () => {
  beforeEach(() => {
    createAgentMock.mockReset()
  })

  it('holds a message typed mid-turn and sends it once the agent is idle', async () => {
    const { agent, backend, events } = await startBackend()
    agent.status = 'running'

    await backend.send({ content: 'later', clientMessageId: 'm1', priority: 'next' })
    expect(agent.sent).toEqual([])

    agent.status = 'idle'
    agent.emit({ type: 'status_change', status: 'idle' })
    await vi.waitFor(() => expect(agent.sent).toEqual(['later']))
    expect(events).toContainEqual({ type: 'queued_message_consumed', clientMessageId: 'm1' })
  })

  it('drops a dequeued message', async () => {
    const { agent, backend } = await startBackend()
    agent.status = 'running'
    await backend.send({ content: 'later', clientMessageId: 'm1', priority: 'next' })

    expect(backend.dequeueMessage('m1')).toBe(true)
    agent.status = 'idle'
    agent.emit({ type: 'status_change', status: 'idle' })

    expect(agent.sent).toEqual([])
  })

  it('steers a queued message into the running turn', async () => {
    const { agent, backend, events } = await startBackend()
    agent.status = 'running'
    await backend.send({ content: 'aside', clientMessageId: 'm1', priority: 'next' })

    await backend.handleCommand({ kind: 'dsh.steer_queued', clientMessageId: 'm1' })

    expect(agent.steered).toEqual(['aside'])
    expect(events).toContainEqual({ type: 'queued_message_consumed', clientMessageId: 'm1' })
    expect(backend.dequeueMessage('m1')).toBe(false)
  })

  it('refuses to steer once the turn is over, keeping the message queued', async () => {
    const { agent, backend } = await startBackend()
    agent.status = 'running'
    await backend.send({ content: 'aside', clientMessageId: 'm1', priority: 'next' })
    agent.status = 'idle'

    await expect(backend.handleCommand({ kind: 'dsh.steer_queued', clientMessageId: 'm1' }))
      .rejects.toThrow(/active DeepSeek turn/)
    expect(agent.steered).toEqual([])
    expect(backend.dequeueMessage('m1')).toBe(true)
  })
})
