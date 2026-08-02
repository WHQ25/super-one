import { describe, expect, it, vi } from 'vitest'
import { forkCodexThread } from './fork-thread'

describe('forkCodexThread', () => {
  it('forks with lastTurnId and skips rollback', async () => {
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
    expect(request).not.toHaveBeenCalledWith('thread/rollback', expect.anything())
  })

  it('falls back to rollback when no lastTurnId', async () => {
    const request = vi.fn(async (method: string) => {
      if (method === 'thread/fork') return { thread: { id: 'thread-new' } }
      return {}
    })
    await forkCodexThread({
      request,
      threadId: 'thread-src',
      dropTrailingTurns: 2,
    })
    expect(request).toHaveBeenCalledWith('thread/fork', { threadId: 'thread-src' })
    expect(request).toHaveBeenCalledWith('thread/rollback', {
      threadId: 'thread-new',
      numTurns: 2,
    })
  })
})
