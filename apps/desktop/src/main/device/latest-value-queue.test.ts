import { describe, expect, it, vi } from 'vitest'
import { LatestValueQueue } from './latest-value-queue'

describe('LatestValueQueue', () => {
  it('keeps only the latest pending value while one send is active', async () => {
    let finishFirst: ((value: number) => void) | undefined
    const send = vi.fn(async (value: number) => {
      if (value === 1) return new Promise<number>((resolve) => { finishFirst = resolve })
      return value * 10
    })
    const queue = new LatestValueQueue(send)

    const first = queue.enqueue(1)
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(1))
    const replaced = queue.enqueue(2)
    const latest = queue.enqueue(3)
    // 2 was overwritten by 3 before it ever went out — one dropped sample.
    expect(queue.takeDroppedCount()).toBe(1)
    expect(queue.takeDroppedCount()).toBe(0)
    finishFirst?.(10)

    await expect(first).resolves.toBe(10)
    await expect(replaced).resolves.toBe(30)
    await expect(latest).resolves.toBe(30)
    await queue.flush()
    expect(send.mock.calls.map(([value]) => value)).toEqual([1, 3])
  })

  it('waits for the active and pending sends before flushing', async () => {
    const send = vi.fn(async (value: number) => value)
    const queue = new LatestValueQueue(send)
    void queue.enqueue(1)
    void queue.enqueue(2)

    await queue.flush()

    expect(send).toHaveBeenCalled()
  })
})
