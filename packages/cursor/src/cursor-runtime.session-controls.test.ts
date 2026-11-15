import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Run, SDKMessage } from '@cursor/sdk'
import type { AgentEvent } from '@superone/shared/agent-types'

const agentState = vi.hoisted(() => {
  const send = vi.fn()
  const summarize = vi.fn()
  const create = vi.fn()
  const resume = vi.fn()
  const agent = {
    agentId: 'agent-1',
    send,
    summarize,
    close: vi.fn(),
    reload: vi.fn(),
    listArtifacts: vi.fn(),
    downloadArtifact: vi.fn(),
  }
  return { send, summarize, create, resume, agent }
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
      resume: vi.fn(async (id: string, options: unknown) => {
        agentState.resume(id, options)
        return agentState.agent
      }),
    },
    Cursor: { configure: vi.fn() },
  }
})

vi.mock('./cursor-store', () => ({
  getCursorAgentStore: () => ({}),
}))

import { createCursorRuntime, type CursorRuntimeOptions } from './cursor-runtime'

function mockRun(overrides: Partial<Run> & { messages?: SDKMessage[] } = {}): Run {
  const messages = overrides.messages ?? []
  return {
    id: 'run-1',
    agentId: 'agent-1',
    status: 'finished',
    supports: () => true,
    unsupportedReason: () => undefined,
    stream: async function* () {
      for (const message of messages) yield message
    },
    conversation: async () => [],
    wait: async () => ({ id: 'run-1', status: 'finished' as const, result: '', durationMs: 1 }),
    cancel: async () => undefined,
    onDidChangeStatus: () => () => undefined,
    steer: async () => 'complete_delivered' as const,
    ...overrides,
  } as Run
}

function baseOpts(onEvent: (event: AgentEvent) => void, extra: Partial<CursorRuntimeOptions> = {}): CursorRuntimeOptions {
  return {
    sessionId: 'sid-1',
    cwd: '/repo',
    userDataRoot: '/tmp/user',
    permissionMode: 'agent',
    sandboxEnabled: false,
    model: 'composer-1',
    config: { apiKey: 'cursor_test_key' },
    onEvent,
    ...extra,
  }
}

describe('cursor runtime session controls', () => {
  beforeEach(() => {
    agentState.send.mockReset()
    agentState.summarize.mockReset()
    agentState.create.mockReset()
    agentState.resume.mockReset()
    agentState.send.mockImplementation(async () => mockRun())
    agentState.summarize.mockImplementation(async () => mockRun())
  })

  it('passes trimmed extra roots on create and resume, and omits them when empty', async () => {
    await createCursorRuntime(baseOpts(() => undefined, {
      additionalDirectories: [' /extra ', '/extra', '', '/other'],
    }))
    expect(agentState.create.mock.calls[0]?.[0]).toMatchObject({
      local: { cwd: '/repo', dirs: ['/extra', '/other'] },
    })

    agentState.create.mockClear()
    await createCursorRuntime(baseOpts(() => undefined))
    expect(agentState.create.mock.calls[0]?.[0].local.dirs).toBeUndefined()

    await createCursorRuntime(baseOpts(() => undefined, {
      providerSessionId: 'agent-9',
      additionalDirectories: ['/extra'],
    }))
    expect(agentState.resume).toHaveBeenCalledWith('agent-9', expect.objectContaining({
      local: expect.objectContaining({ dirs: ['/extra'] }),
    }))
  })

  it('does not pass local dirs to a cloud agent', async () => {
    await createCursorRuntime(baseOpts(() => undefined, {
      additionalDirectories: ['/extra'],
      config: { apiKey: 'cursor_test_key', runtime: 'cloud' },
    }))
    const options = agentState.create.mock.calls[0]?.[0]
    expect(options.cloud).toBeTruthy()
    expect(options.local).toBeUndefined()
  })

  it('maps summarize stream messages onto a manual compact boundary', async () => {
    const events: AgentEvent[] = []
    agentState.summarize.mockImplementation(async () => mockRun({
      messages: [
        { type: 'summary', agent_id: 'agent-1', run_id: 'run-1', status: 'running' },
        { type: 'summary', agent_id: 'agent-1', run_id: 'run-1', status: 'completed', fallback: true },
      ],
    }))
    const runtime = await createCursorRuntime(baseOpts((event) => events.push(event)))
    await runtime.summarize(40)
    expect(agentState.send).not.toHaveBeenCalled()
    expect(events).toContainEqual({ type: 'status_indicator', indicator: 'compacting' })
    expect(events).toContainEqual({
      type: 'compact_boundary',
      trigger: 'manual',
      preTokens: 40,
      messageId: expect.any(String),
    })
    expect(events).toContainEqual({ type: 'status_indicator', indicator: null, compactResult: 'success' })
    expect(events.some((event) => event.type === 'content_delta')).toBe(false)
  })

  it('emits a boundary when summarize finishes without a summary message', async () => {
    const events: AgentEvent[] = []
    const runtime = await createCursorRuntime(baseOpts((event) => events.push(event)))
    await runtime.summarize(7)
    expect(events).toContainEqual({
      type: 'compact_boundary',
      trigger: 'manual',
      preTokens: 7,
      messageId: expect.any(String),
    })
  })

  it('refuses to summarize a cloud agent', async () => {
    const runtime = await createCursorRuntime(baseOpts(() => undefined, {
      config: { apiKey: 'cursor_test_key', runtime: 'cloud' },
    }))
    await expect(runtime.summarize()).rejects.toThrow(/cloud/)
    expect(agentState.summarize).not.toHaveBeenCalled()
  })

  it('reports summarize failure and leaves no success boundary', async () => {
    const events: AgentEvent[] = []
    agentState.summarize.mockImplementation(async () => mockRun({
      messages: [{ type: 'summary', agent_id: 'agent-1', run_id: 'run-1', status: 'error' }],
      wait: async () => ({ id: 'run-1', status: 'error' as const, error: { message: 'no conversation' }, durationMs: 1 }),
    }))
    const runtime = await createCursorRuntime(baseOpts((event) => events.push(event)))
    await expect(runtime.summarize()).rejects.toThrow(/no conversation/)
    expect(events).toContainEqual({ type: 'status_indicator', indicator: null, compactResult: 'failed' })
    expect(events.some((event) => event.type === 'compact_boundary')).toBe(false)
  })

  it('steers the active run and returns revert when nothing is running', async () => {
    const steer = vi.fn(async () => 'complete_delivered' as const)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    agentState.send.mockImplementation(async () => mockRun({
      steer,
      wait: async () => {
        await gate
        return { id: 'run-1', status: 'finished' as const, durationMs: 1 }
      },
    }))
    const runtime = await createCursorRuntime(baseOpts(() => undefined))
    expect(await runtime.steer('too soon')).toBe('revert_to_followup')
    const pending = runtime.send('m1', 'hello')
    await new Promise((resolve) => setImmediate(resolve))
    expect(await runtime.steer('follow up')).toBe('complete_delivered')
    expect(steer).toHaveBeenCalledWith('follow up')
    release()
    await pending
  })

  it('turns an automatic summary on the send stream into a compact boundary and drops delta text', async () => {
    const events: AgentEvent[] = []
    agentState.send.mockImplementation(async (_message, options) => {
      options?.onDelta?.({ update: { type: 'summary', summary: 'do not paste' } })
      return mockRun({
        messages: [{ type: 'summary', agent_id: 'agent-1', run_id: 'run-1', status: 'completed' }],
      })
    })
    const runtime = await createCursorRuntime(baseOpts((event) => events.push(event)))
    await runtime.send('m1', 'hello')
    expect(events.some((event) => event.type === 'content_delta' && event.delta.type === 'text' && event.delta.text.includes('do not paste'))).toBe(false)
    const boundary = events.find((event) => event.type === 'compact_boundary')
    expect(boundary).toMatchObject({
      type: 'compact_boundary',
      trigger: 'auto',
      preTokens: 0,
    })
    expect(boundary).not.toHaveProperty('messageId')
  })
})
