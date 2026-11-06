import { describe, expect, it, vi } from 'vitest'
import { shutdownClaudeQuery } from './query-shutdown'

describe('bounded Claude shutdown', () => {
  it('cancels queued SDK input before ending stdin and draining output', async () => {
    const order: string[] = []
    let finish!: () => void
    await shutdownClaudeQuery({
      query: { interrupt: async () => { order.push('interrupt'); return { still_queued: ['queued'] } },
        cancelAsyncMessage: async id => { order.push(`cancel:${id}`); return true }, close: () => { order.push('close') } },
      interrupt: true, endInput: () => { order.push('eof'); finish() },
      iterationDone: new Promise(resolve => { finish = resolve }), abort: () => { order.push('abort') },
    })
    expect(order).toEqual(['interrupt', 'cancel:queued', 'eof', 'close', 'abort'])
  })

  it('forces teardown if output or interrupt never settles', async () => {
    vi.useFakeTimers()
    const close = vi.fn()
    const abort = vi.fn()
    const endInput = vi.fn()
    try {
      const shutdown = shutdownClaudeQuery({ query: { close, interrupt: () => new Promise(() => {}) },
        interrupt: true, endInput, abort, iterationDone: new Promise(() => {}), timeoutMs: 100 })
      expect(endInput).not.toHaveBeenCalled()
      expect(close).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(100)
      await shutdown
      expect(close).toHaveBeenCalledOnce()
      expect(abort).toHaveBeenCalledOnce()
      expect(endInput).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
})
