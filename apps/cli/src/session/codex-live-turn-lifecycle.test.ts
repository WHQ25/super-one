import { afterEach, expect, it, vi } from 'vitest'
import type { CodexAppServerHandle } from '@superone/codex'
import type { AgentEvent } from '@superone/shared/agent-types'
import { openTurnAndStream } from './codex-live-turn'

afterEach(() => vi.useRealTimers())

it('keeps a live turn attached through long tool work and automatic compaction', async () => {
  vi.useFakeTimers()
  const events: AgentEvent[] = []
  const notes = [
    { method: 'item/agentMessage/delta', params: { itemId: 'answer', delta: 'Working' } },
    { method: 'item/started', params: { item: { id: 'compact', type: 'contextCompaction' } } },
    { method: 'item/completed', params: { item: { id: 'compact', type: 'contextCompaction' } } },
    { method: 'turn/completed', params: { turn: { id: 'turn', status: 'completed' } } },
  ]
  const startedAt = Date.now()
  let nextNoteAt = 120_000
  const client = {
    request: vi.fn().mockResolvedValue({ turn: { id: 'turn' } }),
    nextNotification: vi.fn(async (timeoutMs: number) => {
      await new Promise(resolve => setTimeout(resolve, timeoutMs))
      if (Date.now() - startedAt < nextNoteAt) return null
      nextNoteAt += 120_000
      return notes.shift() ?? null
    }),
  } as unknown as CodexAppServerHandle
  const outcome = openTurnAndStream({
    client, prompt: 'work', cwd: '/work', threadId: 'thread',
    signal: new AbortController().signal, onAgentEvent: event => events.push(event),
  }).then(result => ({ result }), error => ({ error }))

  await vi.advanceTimersByTimeAsync(480_000)
  expect(await outcome).toEqual({ result: { finalText: 'Working', threadId: 'thread', turnId: 'turn' } })
  expect(events).toContainEqual(expect.objectContaining({ type: 'status_indicator', compactResult: 'success' }))
  expect(events.some(event => event.type === 'message_error')).toBe(false)
})

it.each(['abort', 'disconnect'] as const)('ends a long live turn on %s without waiting for completion', async reason => {
  vi.useFakeTimers()
  const controller = new AbortController()
  const events: AgentEvent[] = []
  const client = {
    request: vi.fn().mockResolvedValue({ turn: { id: 'turn' } }),
    nextNotification: vi.fn(async (timeoutMs: number) => {
      await new Promise(resolve => setTimeout(resolve, timeoutMs))
      if (reason === 'disconnect' && Date.now() - startedAt > 360_000) throw new Error('Codex app-server exited unexpectedly')
      return null
    }),
  } as unknown as CodexAppServerHandle
  const startedAt = Date.now()
  const outcome = openTurnAndStream({
    client, prompt: 'work', cwd: '/work', threadId: 'thread',
    signal: controller.signal, onAgentEvent: event => events.push(event),
  }).then(result => ({ result }), error => ({ error }))

  await vi.advanceTimersByTimeAsync(360_000)
  expect(events.some(event => event.type === 'message_error')).toBe(false)
  if (reason === 'abort') controller.abort()
  await vi.advanceTimersByTimeAsync(5_000)
  expect(await outcome).toEqual({ error: expect.objectContaining({ message: reason === 'abort'
    ? 'Codex turn interrupted' : 'Codex app-server exited unexpectedly' }) })
  expect(events).toContainEqual(expect.objectContaining({ type: reason === 'abort' ? 'message_interrupted' : 'message_error' }))
})
