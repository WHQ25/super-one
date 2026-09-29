import { describe, expect, it, vi } from 'vitest'
import { forkCodexThread } from './fork-thread'

describe('forkCodexThread', () => {
  it('forks with lastTurnId without reading the source history', async () => {
    const request = vi.fn(async (method: string) => {
      if (method === 'thread/fork') return { thread: { id: 'thread-new' } }
      return {}
    })
    const id = await forkCodexThread({
      request,
      threadId: 'thread-src',
      lastTurnId: 'turn-1',
      dropTrailingTurns: 2,
    })
    expect(id).toBe('thread-new')
    expect(request).toHaveBeenCalledWith('thread/fork', {
      threadId: 'thread-src',
      lastTurnId: 'turn-1',
    })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('forks before the oldest dropped turn when the transcript has no turn anchor', async () => {
    const request = vi.fn(async (method: string) => {
      if (method === 'thread/turns/list') return { data: [{ id: 'turn-4' }, { id: 'turn-3' }], nextCursor: null }
      if (method === 'thread/fork') return { thread: { id: 'thread-new' } }
      throw new Error(`Unexpected RPC: ${method}`)
    })
    await forkCodexThread({
      request,
      threadId: 'thread-src',
      dropTrailingTurns: 2,
    })
    expect(request).toHaveBeenNthCalledWith(1, 'thread/turns/list', {
      threadId: 'thread-src', sortDirection: 'desc', itemsView: 'notLoaded', limit: 2,
    })
    expect(request).toHaveBeenNthCalledWith(2, 'thread/fork', { threadId: 'thread-src', beforeTurnId: 'turn-3' })
  })

  it('follows short pages to resolve the boundary without hydrating items', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ data: [{ id: 'turn-4' }], nextCursor: 'older' })
      .mockResolvedValueOnce({ data: [{ id: 'turn-3' }, { id: 'turn-2' }], nextCursor: null })
      .mockResolvedValueOnce({ thread: { id: 'thread-new' } })
    await expect(forkCodexThread({ request, threadId: 'thread-src', dropTrailingTurns: 3 })).resolves.toBe('thread-new')
    expect(request).toHaveBeenNthCalledWith(2, 'thread/turns/list', {
      threadId: 'thread-src', sortDirection: 'desc', itemsView: 'notLoaded', limit: 2, cursor: 'older',
    })
    expect(request).toHaveBeenNthCalledWith(3, 'thread/fork', { threadId: 'thread-src', beforeTurnId: 'turn-2' })
  })

  it('drops all available turns when the legacy count exceeds provider history', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ data: [{ id: 'turn-1' }], nextCursor: null })
      .mockResolvedValueOnce({ thread: { id: 'thread-new' } })
    await forkCodexThread({ request, threadId: 'thread-src', dropTrailingTurns: 2 })
    expect(request).toHaveBeenLastCalledWith('thread/fork', { threadId: 'thread-src', beforeTurnId: 'turn-1' })
  })

  it('rejects missing history instead of silently making an unbounded fork', async () => {
    const request = vi.fn().mockResolvedValue({ data: [], nextCursor: null })
    await expect(forkCodexThread({ request, threadId: 'thread-src', dropTrailingTurns: 1 }))
      .rejects.toThrow('fork boundary')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('forks the full thread without querying history when no turns are dropped', async () => {
    const request = vi.fn().mockResolvedValue({ thread: { id: 'thread-new' } })
    await expect(forkCodexThread({ request, threadId: 'thread-src' })).resolves.toBe('thread-new')
    expect(request).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith('thread/fork', { threadId: 'thread-src' })
  })
})
