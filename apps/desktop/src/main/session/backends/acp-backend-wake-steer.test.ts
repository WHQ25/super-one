import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'

vi.mock('../../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../../agent/resolve-cli', () => ({
  getNodeRuntime: () => ({ executable: '/fake/node', env: {} }),
}))

vi.mock('../../usage-stats-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../usage-stats-service')>()
  return {
    ...actual,
    recordAntigravityFromUsage: vi.fn(),
    recordGrokFromUsage: vi.fn(),
  }
})

import { AcpBackend, setAcpRuntimeFactory } from './acp-backend'
import type { AcpRuntimeOptions } from '../../acp/acp-runtime'
import { acpStartOpts, mockAcpRuntime } from '../../../test/fixtures/acp-backend-fixtures'

describe('AcpBackend wake steer & AskUserQuestion routing', () => {
  beforeEach(() => {
    setAcpRuntimeFactory(async () => mockAcpRuntime())
  })

  afterEach(() => {
    setAcpRuntimeFactory(null)
  })

  it('retargets post-steer wakeup session events and AskUserQuestion onto the steered bubble and clears state on completion', async () => {
    let runtimeOpts: AcpRuntimeOptions | undefined
    let promptActive = false
    const promptCalls: Array<{ text: string; messageId: string }> = []
    const interjects: Array<{ text: string; id?: string }> = []

    setAcpRuntimeFactory(async (opts) => {
      runtimeOpts = opts
      return mockAcpRuntime({
        isPromptActive: () => promptActive,
        interject: async (text, id) => {
          interjects.push({ text, id })
        },
        prompt: async (text, messageId, onEvent, _images, pOpts) => {
          pOpts?.onInputAccepted?.()
          promptCalls.push({ text: typeof text === 'string' ? text : String(text), messageId })
          onEvent({ type: 'message_complete', messageId })
          onEvent({ type: 'status_change', status: 'idle' })
        },
      })
    })

    const backend = new AcpBackend('acp-antigravity')
    const events: AgentEvent[] = []
    backend.onEvent((e) => events.push(e))
    await backend.start(acpStartOpts({ agentId: 'antigravity' }))

    await backend.send({ content: 'initial', assistantMessageId: 'a0' })
    expect(promptCalls).toHaveLength(1)

    promptActive = true
    runtimeOpts?.onSessionEvent?.({
      type: 'message_start',
      message: {
        id: 'acp_wake_1',
        role: 'assistant',
        status: 'streaming',
        content: [],
        createdAt: new Date().toISOString(),
        providerId: 'acp',
      },
    })
    runtimeOpts?.onSessionEvent?.({ type: 'status_change', status: 'streaming' })
    runtimeOpts?.onSessionEvent?.({
      type: 'content_delta',
      messageId: 'acp_wake_1',
      delta: { type: 'text', text: 'pre-steer-wake' },
    })

    await backend.send({
      content: 'can diff support lsp?',
      clientMessageId: 'u-steer',
      assistantMessageId: 'a-steer',
      priority: 'next',
    })
    await backend.handleCommand({ kind: 'acp.steer_queued', clientMessageId: 'u-steer' })

    expect(interjects).toEqual([{ text: 'can diff support lsp?', id: 'u-steer' }])

    const splitIndex = events.findIndex(
      (e) => e.type === 'message_start' && e.message.id === 'a-steer',
    )
    expect(splitIndex).toBeGreaterThan(-1)

    runtimeOpts?.onSessionEvent?.({
      type: 'content_delta',
      messageId: 'acp_wake_1',
      delta: { type: 'text', text: 'post-steer-reply' },
    })
    runtimeOpts?.onSessionEvent?.({
      type: 'content_delta',
      messageId: 'acp_wake_1',
      delta: {
        type: 'tool_use',
        toolName: 'AskUserQuestion',
        toolUseId: 'call_ask_1',
        input: JSON.stringify({
          questions: [{ question: 'Enable LSP?', header: 'Enable LSP?', options: [{ label: 'Yes' }], multiSelect: false }],
        }),
        status: 'streaming',
      },
    })

    const questionPromise = runtimeOpts!.askUserQuestion!.request({
      toolCallId: 'call_ask_1',
      questions: [{ id: 'q0', header: 'Question', question: 'Enable LSP?', options: [{ label: 'Yes' }] }],
    })
    backend.respondToQuestion('call_ask_1', { 'Enable LSP?': 'Yes' })
    await questionPromise

    runtimeOpts?.onSessionEvent?.({
      type: 'message_usage',
      messageId: 'acp_wake_1',
      inputTokens: 150,
      outputTokens: 30,
    })
    promptActive = false
    runtimeOpts?.onSessionEvent?.({ type: 'message_complete', messageId: 'acp_wake_1' })
    runtimeOpts?.onSessionEvent?.({ type: 'status_change', status: 'idle' })

    const postSplitEvents = events.slice(splitIndex + 1)
    expect(
      postSplitEvents.some((e) => 'messageId' in e && e.messageId === 'acp_wake_1'),
    ).toBe(false)
    expect(postSplitEvents).toContainEqual(expect.objectContaining({
      type: 'content_delta',
      messageId: 'a-steer',
      delta: { type: 'text', text: 'post-steer-reply' },
    }))
    const askDeltas = postSplitEvents.filter(
      (e): e is Extract<AgentEvent, { type: 'content_delta' }> =>
        e.type === 'content_delta' &&
        ((e.delta.type === 'tool_use' && e.delta.toolUseId === 'call_ask_1') ||
          (e.delta.type === 'tool_result' && e.delta.toolUseId === 'call_ask_1')),
    )
    expect(askDeltas.length).toBeGreaterThanOrEqual(3)
    expect(askDeltas.every((e) => e.messageId === 'a-steer')).toBe(true)
    expect(postSplitEvents).toContainEqual(expect.objectContaining({
      type: 'message_usage',
      messageId: 'a-steer',
      inputTokens: 150,
      outputTokens: 30,
    }))
    expect(postSplitEvents).toContainEqual(expect.objectContaining({
      type: 'message_complete',
      messageId: 'a-steer',
    }))

    await backend.send({ content: 'next turn after wake steer', assistantMessageId: 'a-next' })
    expect(promptCalls).toHaveLength(2)
    expect(promptCalls[1]).toEqual({ text: 'next turn after wake steer', messageId: 'a-next' })

    await backend.close()
  })

  it('keeps AskUserQuestion resolution on the message where the question opened across a mid-question steer', async () => {
    let runtimeOpts: AcpRuntimeOptions | undefined
    let finishPrompt: (() => void) | null = null

    setAcpRuntimeFactory(async (opts) => {
      runtimeOpts = opts
      return mockAcpRuntime({
        interject: async () => {},
        prompt: async (_text, messageId, onEvent, _images, pOpts) => {
          pOpts?.onInputAccepted?.()
          await new Promise<void>((resolve) => {
            finishPrompt = () => {
              onEvent({ type: 'message_complete', messageId })
              onEvent({ type: 'status_change', status: 'idle' })
              resolve()
            }
          })
        },
      })
    })

    const backend = new AcpBackend('acp-antigravity')
    const events: AgentEvent[] = []
    backend.onEvent((e) => events.push(e))
    await backend.start(acpStartOpts({ agentId: 'antigravity' }))

    const firstTurn = backend.send({ content: 'first', assistantMessageId: 'a1' })
    await vi.waitFor(() => expect(finishPrompt).not.toBeNull())

    const questionPromise = runtimeOpts!.askUserQuestion!.request({
      toolCallId: 'call_mid_q',
      questions: [{ id: 'q0', header: 'Question', question: 'Keep on a1?', options: [{ label: 'Yes' }] }],
    })

    await backend.send({
      content: 'steer while question open',
      clientMessageId: 'u-mid',
      assistantMessageId: 'a2',
      priority: 'next',
    })
    await backend.handleCommand({ kind: 'acp.steer_queued', clientMessageId: 'u-mid' })

    backend.respondToQuestion('call_mid_q', { 'Keep on a1?': 'Yes' })
    await questionPromise

    const qEvents = events.filter(
      (e): e is Extract<AgentEvent, { type: 'content_delta' }> =>
        e.type === 'content_delta' &&
        ((e.delta.type === 'tool_use' && e.delta.toolUseId === 'call_mid_q') ||
          (e.delta.type === 'tool_result' && e.delta.toolUseId === 'call_mid_q')),
    )
    expect(qEvents).toHaveLength(3)
    expect(qEvents.every((e) => e.messageId === 'a1')).toBe(true)

    finishPrompt!()
    await firstTurn
    await backend.close()
  })
})
