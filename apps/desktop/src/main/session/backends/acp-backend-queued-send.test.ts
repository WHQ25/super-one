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
    recordGrokFromUsage: vi.fn(),
  }
})

import { AcpBackend, setAcpRuntimeFactory } from './acp-backend'
import { acpStartOpts, mockAcpRuntime } from '../../../test/fixtures/acp-backend-fixtures'

interface PromptCall {
  text: string
  messageId: string
  onEvent: (event: AgentEvent) => void
  sendNow: boolean
  finish: () => void
}

function manualTurnRuntime(
  calls: PromptCall[],
  extras?: { interject?: (text: string, id?: string) => Promise<void> },
) {
  return mockAcpRuntime({
    prompt: async (text, messageId, onEvent, _images, opts) => {
      await new Promise<void>((resolve) => {
        let settled = false
        const finish = () => {
          if (settled) return
          settled = true
          onEvent({ type: 'message_complete', messageId })
          onEvent({ type: 'status_change', status: 'idle' })
          resolve()
        }
        calls.push({
          text: typeof text === 'string' ? text : String(text),
          messageId,
          onEvent,
          sendNow: opts?.sendNow === true,
          finish,
        })
      })
    },
    cancel: async () => {
      calls.at(-1)?.finish()
    },
    ...(extras?.interject ? { interject: extras.interject } : {}),
  })
}

async function startBackend(
  calls: PromptCall[],
  extras?: { interject?: (text: string, id?: string) => Promise<void> },
) {
  setAcpRuntimeFactory(async () => manualTurnRuntime(calls, extras))
  const backend = new AcpBackend()
  const events: AgentEvent[] = []
  backend.onEvent((e) => events.push(e))
  await backend.start(acpStartOpts({ agentId: 'grok-build' }))
  return { backend, events }
}

const messageStarts = (events: AgentEvent[]): string[] =>
  events.filter((e) => e.type === 'message_start').map((e) => (e as { message: { id: string } }).message.id)

describe('AcpBackend queued send / interject', () => {
  beforeEach(() => {
    setAcpRuntimeFactory(async () => mockAcpRuntime())
  })

  afterEach(() => {
    setAcpRuntimeFactory(null)
  })

  it('queues a mid-turn follow-up instead of prompting concurrently', async () => {
    const calls: PromptCall[] = []
    const interjects: Array<{ text: string; id?: string }> = []
    const { backend, events } = await startBackend(calls, {
      interject: async (text, id) => { interjects.push({ text, id }) },
    })

    void backend.send({ content: 'first', assistantMessageId: 'a1' })
    await vi.waitFor(() => expect(calls).toHaveLength(1))

    await backend.send({ content: 'second', clientMessageId: 'u2', priority: 'next' })

    expect(calls).toHaveLength(1)
    expect(interjects).toEqual([])
    expect(messageStarts(events)).toEqual(['a1'])
    expect(events.some((e) => e.type === 'queued_message_consumed')).toBe(false)

    calls[0].finish()
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1].text).toContain('second')
    const consumed = events.filter((e) => e.type === 'queued_message_consumed')
    expect(consumed).toHaveLength(1)
    expect((consumed[0] as { clientMessageId: string }).clientMessageId).toBe('u2')

    calls[1].finish()
    await backend.close()
  })

  it('steers a queued follow-up into the live turn and splits the assistant', async () => {
    const calls: PromptCall[] = []
    const interjects: Array<{ text: string; id?: string }> = []
    const { backend, events } = await startBackend(calls, {
      interject: async (text, id) => { interjects.push({ text, id }) },
    })

    void backend.send({ content: 'first', assistantMessageId: 'a1' })
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    await backend.send({
      content: 'second',
      clientMessageId: 'u2',
      assistantMessageId: 'a2',
      priority: 'next',
    })

    await backend.handleCommand({ kind: 'acp.steer_queued', clientMessageId: 'u2' })

    expect(calls).toHaveLength(1)
    expect(interjects).toEqual([{ text: 'second', id: 'u2' }])
    const completeAt = events.findIndex((e) => e.type === 'message_complete' && e.messageId === 'a1')
    const consumedAt = events.findIndex((e) => e.type === 'queued_message_consumed')
    const startA2 = events.findIndex((e) => e.type === 'message_start' && e.message.id === 'a2')
    expect(completeAt).toBeGreaterThanOrEqual(0)
    expect(consumedAt).toBeGreaterThan(completeAt)
    expect(startA2).toBeGreaterThan(consumedAt)
    expect(messageStarts(events)).toEqual(['a1', 'a2'])
    expect((events[consumedAt] as { clientMessageId: string }).clientMessageId).toBe('u2')

    calls[0].onEvent({
      type: 'content_delta',
      messageId: 'a1',
      delta: { type: 'text', text: 'after-steer' },
    })
    const deltas = events.filter((e) => e.type === 'content_delta')
    expect(deltas).toContainEqual(expect.objectContaining({
      messageId: 'a2',
      delta: { type: 'text', text: 'after-steer' },
    }))
    expect(deltas.filter((e) => e.messageId === 'a1')).toEqual([])

    calls[0].finish()
    await backend.close()
  })

  it('steers now with session/prompt sendNow and keeps interject for soon', async () => {
    const calls: PromptCall[] = []
    const interjects: string[] = []
    const { backend, events } = await startBackend(calls, {
      interject: async (text) => { interjects.push(text) },
    })

    void backend.send({ content: 'first', assistantMessageId: 'a1' })
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    await backend.send({
      content: 'cut in',
      clientMessageId: 'u-now',
      assistantMessageId: 'a-now',
      priority: 'next',
    })
    await backend.send({
      content: 'after this tool',
      clientMessageId: 'u-soon',
      assistantMessageId: 'a-soon',
      priority: 'next',
    })

    await backend.handleCommand({ kind: 'acp.steer_queued', clientMessageId: 'u-now', priority: 'now' })
    await backend.handleCommand({ kind: 'acp.steer_queued', clientMessageId: 'u-soon', priority: 'next' })

    expect(interjects).toEqual(['after this tool'])
    expect(calls.map((call) => call.sendNow)).toEqual([false, true])
    expect(calls[1]?.text).toContain('cut in')
    expect(calls[1]?.messageId).toBe('a-now')

    calls[1]?.onEvent({
      type: 'content_delta',
      messageId: 'a-now',
      delta: { type: 'text', text: 'cut' },
    })
    expect(events.some((event) => event.type === 'queued_message_consumed' && event.clientMessageId === 'u-now')).toBe(true)
    expect(messageStarts(events)).toContain('a-now')

    calls[0]?.finish()
    await backend.send({ content: 'while replacement runs', assistantMessageId: 'a3' })
    expect(calls).toHaveLength(2)

    calls[1]?.finish()
    await vi.waitFor(() => expect(calls).toHaveLength(3))
    expect(calls[2]?.text).toContain('while replacement runs')
    await backend.close()
  })

  it('puts a rejected sendNow message back on the queue', async () => {
    const calls: PromptCall[] = []
    setAcpRuntimeFactory(async () => mockAcpRuntime({
      prompt: async (text, messageId, onEvent, _images, opts) => {
        if (opts?.sendNow) {
          onEvent({
            type: 'message_error',
            messageId,
            error: 'sendNow rejected',
          })
          onEvent({ type: 'status_change', status: 'error' })
          throw new Error('sendNow rejected')
        }
        await new Promise<void>((resolve) => {
          calls.push({
            text: typeof text === 'string' ? text : String(text),
            messageId,
            onEvent,
            sendNow: false,
            finish: () => {
              onEvent({ type: 'message_complete', messageId })
              onEvent({ type: 'status_change', status: 'idle' })
              resolve()
            },
          })
        })
      },
    }))
    const backend = new AcpBackend()
    const events: AgentEvent[] = []
    backend.onEvent((event) => events.push(event))
    await backend.start(acpStartOpts({ agentId: 'grok-build' }))

    void backend.send({ content: 'first', assistantMessageId: 'a1' })
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    await backend.send({ content: 'cut in', clientMessageId: 'u-now', assistantMessageId: 'a-now', priority: 'next' })
    await backend.handleCommand({ kind: 'acp.steer_queued', clientMessageId: 'u-now', priority: 'now' })

    expect(events.some((event) => event.type === 'queued_message_consumed')).toBe(false)
    calls[0]?.finish()
    await vi.waitFor(() => expect(calls.some((call) => call.text.includes('cut in') && !call.sendNow)).toBe(true))
    calls.find((call) => call.text.includes('cut in'))?.finish()
    await backend.close()
  })

  it('restores the queued message when steer interject fails', async () => {
    const calls: PromptCall[] = []
    const { backend, events } = await startBackend(calls, {
      interject: async () => { throw new Error('method not found') },
    })

    void backend.send({ content: 'first', assistantMessageId: 'a1' })
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    await backend.send({ content: 'second', clientMessageId: 'u2', priority: 'next' })

    await expect(backend.handleCommand({ kind: 'acp.steer_queued', clientMessageId: 'u2' }))
      .rejects.toThrow(/interject is unavailable/)
    expect(events.some((e) => e.type === 'queued_message_consumed')).toBe(false)

    calls[0].finish()
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1].text).toContain('second')

    calls[1].finish()
    await backend.close()
  })

  it('falls back to a queued extra turn when interject is unavailable', async () => {
    const calls: PromptCall[] = []
    const { backend, events } = await startBackend(calls, {
      interject: async () => { throw new Error('method not found') },
    })

    void backend.send({ content: 'first', assistantMessageId: 'a1' })
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    await backend.send({ content: 'second', clientMessageId: 'u2', priority: 'next' })

    expect(calls).toHaveLength(1)
    expect(events.some((e) => e.type === 'queued_message_consumed')).toBe(false)

    calls[0].finish()
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1].text).toContain('second')
    const consumed = events.filter((e) => e.type === 'queued_message_consumed')
    expect(consumed).toHaveLength(1)
    expect((consumed[0] as { clientMessageId: string }).clientMessageId).toBe('u2')

    calls[1].finish()
    await backend.close()
  })

  it('still reports consumption when the turn settled before the queued send arrived', async () => {
    const calls: PromptCall[] = []
    const { backend, events } = await startBackend(calls)

    void backend.send({ content: 'second', clientMessageId: 'u2', priority: 'next' })
    await vi.waitFor(() => expect(calls).toHaveLength(1))

    const consumed = events.filter((e) => e.type === 'queued_message_consumed')
    expect(consumed).toHaveLength(1)
    expect((consumed[0] as { clientMessageId: string }).clientMessageId).toBe('u2')

    calls[0].finish()
    await backend.close()
  })

  it('drops a queued message that is dequeued before the turn ends', async () => {
    const calls: PromptCall[] = []
    const { backend, events } = await startBackend(calls, {
      interject: async () => { throw new Error('method not found') },
    })

    void backend.send({ content: 'first', assistantMessageId: 'a1' })
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    await backend.send({ content: 'second', clientMessageId: 'u2', priority: 'next' })

    expect(backend.dequeueMessage('u2')).toBe(true)

    calls[0].finish()
    await new Promise((r) => setTimeout(r, 10))
    expect(calls).toHaveLength(1)
    expect(events.some((e) => e.type === 'queued_message_consumed')).toBe(false)

    await backend.close()
  })

  it('discards queued messages when the turn is interrupted', async () => {
    const calls: PromptCall[] = []
    const { backend, events } = await startBackend(calls, {
      interject: async () => { throw new Error('method not found') },
    })

    void backend.send({ content: 'first', assistantMessageId: 'a1' })
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    await backend.send({ content: 'second', clientMessageId: 'u2', priority: 'next' })

    await backend.interrupt()
    calls[0].finish()
    await new Promise((r) => setTimeout(r, 10))

    expect(calls).toHaveLength(1)
    expect(events.some((e) => e.type === 'queued_message_consumed')).toBe(false)

    await backend.close()
  })

  it('drops the goal snapshot after /goal clear when Grok reports nothing', async () => {
    const calls: PromptCall[] = []
    const { backend, events } = await startBackend(calls)

    const clear = backend.send({ content: '/goal clear', assistantMessageId: 'a1' })
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    calls[0].finish()
    await clear

    const goals = events.filter((e) => e.type === 'session_goal')
    expect(goals).toEqual([{ type: 'session_goal', goal: null }])
    await backend.close()
  })

  it('leaves a Grok-reported goal_updated alone after /goal clear', async () => {
    const calls: PromptCall[] = []
    const { backend, events } = await startBackend(calls)

    const clear = backend.send({ content: '/goal clear', assistantMessageId: 'a1' })
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    calls[0].onEvent({ type: 'session_goal', goal: null })
    calls[0].finish()
    await clear

    expect(events.filter((e) => e.type === 'session_goal')).toHaveLength(1)
    await backend.close()
  })

  it('cancels the live turn so a /goal slash is a new prompt, not a queued follow-up', async () => {
    const calls: PromptCall[] = []
    const { backend, events } = await startBackend(calls, {
      interject: async () => { throw new Error('must not interject a /goal line') },
    })

    void backend.send({ content: '/goal Ship login', assistantMessageId: 'a1' })
    await vi.waitFor(() => expect(calls).toHaveLength(1))

    const pause = backend.send({
      content: '/goal pause',
      clientMessageId: 'u2',
      assistantMessageId: 'a2',
      priority: 'next',
    })
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1].text).toContain('/goal pause')
    expect(messageStarts(events)).toEqual(['a1', 'a2'])
    const consumed = events.filter((e) => e.type === 'queued_message_consumed')
    expect(consumed).toHaveLength(1)
    expect((consumed[0] as { clientMessageId: string }).clientMessageId).toBe('u2')

    calls[1].finish()
    await pause
    await backend.close()
  })
})
