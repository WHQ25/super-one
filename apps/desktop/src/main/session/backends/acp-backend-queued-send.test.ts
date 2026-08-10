import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'

vi.mock('../../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../../agent/resolve-cli', () => ({
  getNodeRuntime: () => ({ executable: '/fake/node', env: {} }),
}))

vi.mock('../../usage-stats-service', () => ({
  recordGrokFromUsage: vi.fn(),
}))

import { AcpBackend, setAcpRuntimeFactory } from './acp-backend'
import { acpStartOpts, mockAcpRuntime } from '../../../test/fixtures/acp-backend-fixtures'

interface PromptCall {
  text: string
  messageId: string
  /** Ends this turn the way the agent would. */
  finish: () => void
}

/**
 * Runtime whose turns stay open until the test ends them, so a queued send
 * lands while a prompt is genuinely in flight.
 */
function manualTurnRuntime(calls: PromptCall[]) {
  return mockAcpRuntime({
    prompt: async (text, messageId, onEvent) => {
      await new Promise<void>((resolve) => {
        calls.push({
          text: typeof text === 'string' ? text : String(text),
          messageId,
          finish: () => {
            onEvent({ type: 'message_complete', messageId })
            onEvent({ type: 'status_change', status: 'idle' })
            resolve()
          },
        })
      })
    },
  })
}

async function startBackend(calls: PromptCall[]) {
  setAcpRuntimeFactory(async () => manualTurnRuntime(calls))
  const backend = new AcpBackend()
  const events: AgentEvent[] = []
  backend.onEvent((e) => events.push(e))
  await backend.start(acpStartOpts({ agentId: 'grok-build' }))
  return { backend, events }
}

const messageStarts = (events: AgentEvent[]): string[] =>
  events.filter((e) => e.type === 'message_start').map((e) => (e as { message: { id: string } }).message.id)

describe('AcpBackend queued send', () => {
  beforeEach(() => {
    setAcpRuntimeFactory(async () => mockAcpRuntime())
  })

  afterEach(() => {
    setAcpRuntimeFactory(null)
  })

  it('holds a queued message instead of prompting concurrently mid-turn', async () => {
    const calls: PromptCall[] = []
    const { backend, events } = await startBackend(calls)

    void backend.send({ content: 'first', assistantMessageId: 'a1' })
    await vi.waitFor(() => expect(calls).toHaveLength(1))

    await backend.send({ content: 'second', clientMessageId: 'u2', priority: 'next' })

    // A second concurrent session/prompt is what makes Grok cancel the live turn.
    expect(calls).toHaveLength(1)
    expect(messageStarts(events)).toEqual(['a1'])
    expect(events.some((e) => e.type === 'queued_message_consumed')).toBe(false)

    calls[0].finish()
    await backend.close()
  })

  it('consumes the queued message as its own turn once the live turn ends', async () => {
    const calls: PromptCall[] = []
    const { backend, events } = await startBackend(calls)

    void backend.send({ content: 'first', assistantMessageId: 'a1' })
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    await backend.send({ content: 'second', clientMessageId: 'u2', priority: 'next' })

    calls[0].finish()
    await vi.waitFor(() => expect(calls).toHaveLength(2))

    expect(calls[1].text).toContain('second')
    // Session appends the user bubble only when this event lands.
    const consumed = events.filter((e) => e.type === 'queued_message_consumed')
    expect(consumed).toHaveLength(1)
    expect((consumed[0] as { clientMessageId: string }).clientMessageId).toBe('u2')
    // The queued turn opens its own assistant bubble, after the first one.
    const starts = messageStarts(events)
    expect(starts).toHaveLength(2)
    expect(starts[0]).toBe('a1')
    expect(starts[1]).not.toBe('a1')

    calls[1].finish()
    await backend.close()
  })

  it('still reports consumption when the turn settled before the queued send arrived', async () => {
    // Session decides `priority: 'next'` from its own streaming flag, which can
    // lag the backend by a tick. Without the consumed event the user bubble
    // would never leave Session's pending map.
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
    const { backend, events } = await startBackend(calls)

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
    const { backend, events } = await startBackend(calls)

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
