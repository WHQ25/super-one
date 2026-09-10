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
  finish: () => void
}

function manualTurnRuntime(
  calls: PromptCall[],
  extras?: { interject?: (text: string, id?: string) => Promise<void> },
) {
  return mockAcpRuntime({
    prompt: async (text, messageId, onEvent) => {
      await new Promise<void>((resolve) => {
        calls.push({
          text: typeof text === 'string' ? text : String(text),
          messageId,
          onEvent,
          finish: () => {
            onEvent({ type: 'message_complete', messageId })
            onEvent({ type: 'status_change', status: 'idle' })
            resolve()
          },
        })
      })
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
})
