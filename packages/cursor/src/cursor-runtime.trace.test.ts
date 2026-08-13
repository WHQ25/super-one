import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Run, SDKAgent, SDKMessage } from '@cursor/sdk'

const agentState = vi.hoisted(() => {
  const send = vi.fn()
  const agent = {
    agentId: 'agent-1',
    send,
    close: vi.fn(),
    reload: vi.fn(),
    listArtifacts: vi.fn(),
    downloadArtifact: vi.fn(),
  }
  return { send, agent }
})

vi.mock('@cursor/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cursor/sdk')>()
  return {
    ...actual,
    Agent: {
      create: vi.fn(async () => agentState.agent),
      resume: vi.fn(async () => agentState.agent),
    },
    Cursor: {
      configure: vi.fn(),
    },
  }
})

vi.mock('./cursor-store', () => ({
  getCursorAgentStore: () => ({}),
}))

import { createCursorRuntime } from './cursor-runtime'

const delta = { type: 'text-delta', text: 'hi' } as const
const step = { type: 'assistantMessage', message: { text: 'hi' } } as const
const streamMsg: SDKMessage = {
  type: 'assistant',
  agent_id: 'agent-1',
  run_id: 'run-1',
  message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
}
const result = { id: 'run-1', status: 'finished' as const, result: 'hi', durationMs: 42 }

function mockRun(): Run {
  return {
    id: 'run-1',
    agentId: 'agent-1',
    status: 'finished',
    supports: () => true,
    unsupportedReason: () => undefined,
    stream: async function* () {
      yield streamMsg
    },
    conversation: async () => [],
    wait: async () => {
      await new Promise<void>((resolve) => setImmediate(resolve))
      return result
    },
    cancel: async () => undefined,
    onDidChangeStatus: () => () => undefined,
  } as Run
}

describe('createCursorRuntime event-trace', () => {
  beforeEach(() => {
    agentState.send.mockReset()
    agentState.send.mockImplementation(async (_message, options) => {
      options?.onDelta?.({ update: delta })
      options?.onStep?.({ step })
      return mockRun()
    })
  })

  it('traces every raw SDK channel plus create/send lifecycle', async () => {
    const onSdkTrace = vi.fn()
    const runtime = await createCursorRuntime({
      sessionId: 'sid-1',
      cwd: '/repo',
      userDataRoot: '/tmp/user',
      permissionMode: 'auto',
      sandboxEnabled: false,
      model: 'composer-1',
      config: { apiKey: 'cursor_test_key' },
      onEvent: () => undefined,
      onSdkTrace,
    })

    expect(onSdkTrace).toHaveBeenCalledWith(
      'cursor.runtime',
      'create_session',
      expect.objectContaining({ sessionId: 'sid-1', sandboxEnabled: false }),
      'sid-1',
    )
    expect(onSdkTrace).toHaveBeenCalledWith(
      'cursor.runtime',
      'agent_ready',
      expect.objectContaining({ agentId: 'agent-1' }),
      'sid-1',
    )

    await runtime.send('msg-1', 'hello')

    expect(onSdkTrace).toHaveBeenCalledWith(
      'agent.sdk',
      'user_send',
      { text: 'hello' },
      'msg-1',
    )
    expect(onSdkTrace).toHaveBeenCalledWith('agent.sdk', 'text-delta', delta, 'msg-1')
    expect(onSdkTrace).toHaveBeenCalledWith('agent.sdk', 'assistantMessage', step, 'msg-1')
    expect(onSdkTrace).toHaveBeenCalledWith('agent.sdk', 'assistant', streamMsg, 'msg-1')
    expect(onSdkTrace).toHaveBeenCalledWith('agent.sdk', 'result', result, 'msg-1')
    expect(onSdkTrace).toHaveBeenCalledWith(
      'cursor.runtime',
      'send_start',
      expect.objectContaining({ messageId: 'msg-1' }),
      'msg-1',
    )
    expect(onSdkTrace).toHaveBeenCalledWith(
      'cursor.runtime',
      'run_started',
      expect.objectContaining({ runId: 'run-1', agentId: 'agent-1' }),
      'msg-1',
    )
  })

  it('still sends when no tracer is injected', async () => {
    const runtime = await createCursorRuntime({
      sessionId: 'sid-1',
      cwd: '/repo',
      userDataRoot: '/tmp/user',
      permissionMode: 'auto',
      sandboxEnabled: false,
      model: 'composer-1',
      config: { apiKey: 'cursor_test_key' },
      onEvent: () => undefined,
    })
    await expect(runtime.send('msg-1', 'hello')).resolves.toMatchObject({ runId: 'run-1' })
  })
})
