import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import { runCodexAppServerTurn, type CodexAppServerHandle } from './app-server-client'

afterEach(() => vi.useRealTimers())

describe.each(['run', 'review', 'compact'] as const)('%s turn lifetime', turnKind => {
  it('waits through silent work beyond five minutes and completes compaction successfully', async () => {
    vi.useFakeTimers()
    const events: AgentEvent[] = []
    const notes = [
      { method: 'item/started', params: { item: { id: 'compact', type: 'contextCompaction' } } },
      { method: 'item/completed', params: { item: { id: 'compact', type: 'contextCompaction' } } },
      { method: 'turn/completed', params: { turn: { id: 'turn', status: 'completed' } } },
    ]
    const startedAt = Date.now()
    let nextNoteAt = 240_000
    const client = {
      request: vi.fn().mockResolvedValue({ turn: { id: 'turn' } }),
      nextNotification: vi.fn(async (timeoutMs: number) => {
        await new Promise(resolve => setTimeout(resolve, timeoutMs))
        if (Date.now() - startedAt < nextNoteAt) return null
        nextNoteAt += 240_000
        return notes.shift() ?? null
      }),
    } as unknown as CodexAppServerHandle
    const outcome = runCodexAppServerTurn({
      client, prompt: 'work', cwd: '/work', threadId: 'thread', skipThreadSetup: true,
      turnKind, signal: new AbortController().signal, onAgentEvent: event => events.push(event),
    }).then(result => ({ result }), error => ({ error }))

    await vi.advanceTimersByTimeAsync(720_000)
    expect(await outcome).toEqual({ result: {
      finalText: turnKind === 'compact' ? 'Conversation compacted.' : '', threadId: 'thread',
      turnId: turnKind === 'compact' ? null : 'turn',
    } })
    expect(events).toContainEqual(expect.objectContaining({ type: 'status_indicator', compactResult: 'success' }))
    expect(events.some(event => event.type === 'message_error')).toBe(false)
  })

  it.each(['abort', 'disconnect'] as const)('ends on %s after five minutes', async reason => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const events: AgentEvent[] = []
    const startedAt = Date.now()
    const client = {
      request: vi.fn().mockResolvedValue({ turn: { id: 'turn' } }),
      nextNotification: vi.fn(async (timeoutMs: number) => {
        await new Promise(resolve => setTimeout(resolve, timeoutMs))
        if (reason === 'disconnect' && Date.now() - startedAt > 360_000) throw new Error('Codex app-server exited unexpectedly')
        return null
      }),
    } as unknown as CodexAppServerHandle
    const outcome = runCodexAppServerTurn({
      client, prompt: 'work', cwd: '/work', threadId: 'thread', skipThreadSetup: true,
      turnKind, signal: controller.signal, onAgentEvent: event => events.push(event),
    }).then(result => ({ result }), error => ({ error }))

    await vi.advanceTimersByTimeAsync(360_000)
    expect(events.some(event => event.type === 'message_error')).toBe(false)
    if (reason === 'abort') controller.abort()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await outcome).toEqual({ error: expect.objectContaining({ message: reason === 'abort'
      ? 'Codex turn interrupted' : 'Codex app-server exited unexpectedly' }) })
    expect(events).toContainEqual(expect.objectContaining({ type: reason === 'abort' ? 'message_interrupted' : 'message_error' }))
  })
})
