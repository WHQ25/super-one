import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Run, SDKCustomTool } from '@cursor/sdk'
import type { AgentEvent } from '@superone/shared/agent-types'

const agentState = vi.hoisted(() => {
  const send = vi.fn()
  const create = vi.fn()
  const agent = {
    agentId: 'agent-1',
    send,
    close: vi.fn(),
    reload: vi.fn(),
    listArtifacts: vi.fn(),
    downloadArtifact: vi.fn(),
  }
  return { send, create, agent }
})

vi.mock('@cursor/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cursor/sdk')>()
  return {
    ...actual,
    Agent: {
      create: vi.fn(async (options: unknown) => {
        agentState.create(options)
        return agentState.agent
      }),
      resume: vi.fn(async () => agentState.agent),
    },
    Cursor: { configure: vi.fn() },
  }
})

vi.mock('./cursor-store', () => ({
  getCursorAgentStore: () => ({}),
}))

import { CURSOR_ASK_USER_QUESTION_TOOL } from './cursor-custom-tools'
import { createCursorRuntime, type CursorRuntimeInteractions } from './cursor-runtime'

/** Terminal statuses of the installed SDK's `RunResultStatus` (`dist/esm/run.d.ts`). */
type RunResultStatus = 'finished' | 'error' | 'cancelled'

function mockRun(status: RunResultStatus = 'finished', hooks?: { onCancel?: () => void; release?: Promise<void> }): Run {
  return {
    id: 'run-1',
    agentId: 'agent-1',
    status,
    supports: () => true,
    unsupportedReason: () => undefined,
    stream: async function* () {},
    conversation: async () => [],
    wait: async () => {
      await (hooks?.release ?? new Promise<void>((resolve) => setImmediate(resolve)))
      return { id: 'run-1', status, result: '', durationMs: 1 }
    },
    cancel: async () => { hooks?.onCancel?.() },
    onDidChangeStatus: () => () => undefined,
  } as unknown as Run
}

/** Custom tools the runtime handed to `Agent.create` (local agents only). */
function createdCustomTools(): Record<string, SDKCustomTool> | undefined {
  const options = agentState.create.mock.calls.at(-1)?.[0] as { local?: { customTools?: Record<string, SDKCustomTool> } } | undefined
  return options?.local?.customTools
}

function makeInteractions(): CursorRuntimeInteractions & { calls: { question: unknown[]; plan: unknown[]; cancel: string[] } } {
  const calls = { question: [] as unknown[], plan: [] as unknown[], cancel: [] as string[] }
  return {
    calls,
    askQuestion: vi.fn(async (request) => {
      calls.question.push(request)
      return { kind: 'answered' as const, answers: { Database: 'Postgres' } }
    }),
    requestPlanApproval: vi.fn(async (request) => {
      calls.plan.push(request)
      return { kind: 'approved' as const }
    }),
    cancelQuestions: vi.fn((reason: string) => { calls.cancel.push(reason) }),
  }
}

async function makeRuntime(interactions: CursorRuntimeInteractions | undefined, permissionMode: 'agent' | 'plan' = 'agent') {
  const events: AgentEvent[] = []
  const runtime = await createCursorRuntime({
    sessionId: 'sid-1',
    cwd: '/repo',
    userDataRoot: '/tmp/user',
    permissionMode,
    sandboxEnabled: false,
    model: 'composer-1',
    config: { apiKey: 'cursor_test_key' },
    onEvent: (event) => events.push(event),
    ...(interactions ? { interactions } : {}),
  })
  return { runtime, events }
}

describe('createCursorRuntime host interactions bridge', () => {
  beforeEach(() => {
    agentState.send.mockReset()
    agentState.create.mockReset()
    agentState.send.mockImplementation(async () => mockRun())
  })

  it('exposes the ask-user-question custom tool and routes it to the host resolver', async () => {
    const interactions = makeInteractions()
    await makeRuntime(interactions)

    const tools = createdCustomTools()
    expect(tools).toBeDefined()
    expect(Object.keys(tools!)).toEqual(expect.arrayContaining(['superone_session_info', CURSOR_ASK_USER_QUESTION_TOOL]))

    const result = await tools![CURSOR_ASK_USER_QUESTION_TOOL]!.execute(
      { questions: [{ question: 'Which database?', options: [{ label: 'Postgres' }, { label: 'SQLite' }] }] },
      { toolCallId: 'call-42' },
    )
    expect(interactions.calls.question).toEqual([
      expect.objectContaining({ requestId: 'call-42', questions: [expect.objectContaining({ question: 'Which database?' })] }),
    ])
    expect(result).toEqual({ outcome: 'answered', answers: { Database: 'Postgres' } })
  })

  it('reports invalid question input as a tool error without asking the host', async () => {
    const interactions = makeInteractions()
    await makeRuntime(interactions)
    const result = await createdCustomTools()![CURSOR_ASK_USER_QUESTION_TOOL]!.execute({ questions: [] }, {})
    expect(result).toMatchObject({ isError: true })
    expect(interactions.calls.question).toEqual([])
  })

  it('omits the question tool and hint when no host resolver is wired', async () => {
    await makeRuntime(undefined)
    expect(Object.keys(createdCustomTools() ?? {})).toEqual(['superone_session_info'])
  })

  it('tells the model to use the host question tool in the system context', async () => {
    const interactions = makeInteractions()
    const { runtime } = await makeRuntime(interactions)
    await runtime.send('msg-1', 'hello')
    const [message] = agentState.send.mock.calls[0] as [{ text?: string } | string]
    const text = typeof message === 'string' ? message : message.text ?? ''
    expect(text).toContain(CURSOR_ASK_USER_QUESTION_TOOL)
  })

  it('cancels outstanding questions when the run settles, on success and on failure', async () => {
    const interactions = makeInteractions()
    const { runtime } = await makeRuntime(interactions)
    await runtime.send('msg-1', 'hello')
    expect(interactions.calls.cancel).toEqual(['turn ended'])

    // A run that dies mid-flight (transport error) must release its question too.
    agentState.send.mockImplementationOnce(async () => ({
      ...mockRun(),
      wait: async () => { throw new Error('boom') },
    }) as unknown as Run)
    await expect(runtime.send('msg-2', 'hello')).rejects.toBeTruthy()
    expect(interactions.calls.cancel).toEqual(['turn ended', 'turn ended'])
  })

  it('raises plan_approval after the run settles when createPlan completes in plan mode', async () => {
    const interactions = makeInteractions()
    const { runtime } = await makeRuntime(interactions, 'plan')
    agentState.send.mockImplementationOnce(async (_message, options) => {
      options?.onDelta?.({
        update: {
          type: 'tool-call-completed',
          callId: 'call-plan',
          toolCall: { type: 'createPlan', args: { plan: '# The plan' }, result: { status: 'success', value: {} } },
        },
      })
      return mockRun()
    })
    await runtime.send('msg-1', 'make a plan')
    expect(interactions.calls.plan).toEqual([
      { requestId: 'call-plan', planContent: '# The plan', planFilePath: '', allowedPrompts: [] },
    ])
  })

  it('does not raise plan_approval for a run the SDK reports as cancelled', async () => {
    const interactions = makeInteractions()
    const { runtime } = await makeRuntime(interactions, 'plan')
    agentState.send.mockImplementationOnce(async (_message, options) => {
      options?.onDelta?.({
        update: {
          type: 'tool-call-completed',
          callId: 'call-plan',
          toolCall: { type: 'createPlan', args: { plan: '# The plan' }, result: { status: 'success', value: {} } },
        },
      })
      return mockRun('cancelled')
    })
    await runtime.send('msg-1', 'make a plan')
    expect(interactions.calls.plan).toEqual([])
  })

  it('does not let a late `finished` result raise a plan after an explicit cancel', async () => {
    const interactions = makeInteractions()
    const { runtime } = await makeRuntime(interactions, 'plan')
    let release: () => void = () => undefined
    const released = new Promise<void>((resolve) => { release = resolve })
    let sdkCancelled = false
    agentState.send.mockImplementationOnce(async (_message, options) => {
      options?.onDelta?.({
        update: {
          type: 'tool-call-completed',
          callId: 'call-plan',
          toolCall: { type: 'createPlan', args: { plan: '# The plan' }, result: { status: 'success', value: {} } },
        },
      })
      // The SDK may still settle as `finished` when cancel lands after the last tool call.
      return mockRun('finished', { onCancel: () => { sdkCancelled = true }, release: released })
    })
    const turn = runtime.send('msg-1', 'make a plan')
    await new Promise<void>((resolve) => setImmediate(resolve))
    await runtime.cancel()
    expect(sdkCancelled).toBe(true)
    release()
    await turn
    expect(interactions.calls.plan).toEqual([])
    expect(interactions.calls.cancel).toEqual(['turn ended'])
  })

  it('does not raise plan_approval outside plan mode or when the run errored', async () => {
    const planDelta = {
      update: {
        type: 'tool-call-completed',
        callId: 'call-plan',
        toolCall: { type: 'createPlan', args: { plan: '# The plan' }, result: { status: 'success', value: {} } },
      },
    }
    const agentModeInteractions = makeInteractions()
    const agentMode = await makeRuntime(agentModeInteractions, 'agent')
    agentState.send.mockImplementationOnce(async (_message, options) => {
      options?.onDelta?.(planDelta)
      return mockRun()
    })
    await agentMode.runtime.send('msg-1', 'go')
    expect(agentModeInteractions.calls.plan).toEqual([])

    const erroredInteractions = makeInteractions()
    const errored = await makeRuntime(erroredInteractions, 'plan')
    agentState.send.mockImplementationOnce(async (_message, options) => {
      options?.onDelta?.(planDelta)
      return mockRun('error')
    })
    await errored.runtime.send('msg-2', 'go').catch(() => undefined)
    expect(erroredInteractions.calls.plan).toEqual([])
  })
})
