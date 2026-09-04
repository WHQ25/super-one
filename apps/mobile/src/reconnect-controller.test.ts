import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReconnectController } from './reconnect-controller'

afterEach(() => vi.useRealTimers())

describe('ReconnectController', () => {
  it('retries with bounded backoff and reports connected only after restore', async () => {
    vi.useFakeTimers()
    let resolveRestore!: (epoch: number) => void
    const restore = vi.fn(() => new Promise<number>((resolve) => { resolveRestore = resolve }))
    const reconnect = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined)
    const onState = vi.fn()
    const onRetry = vi.fn()
    const controller = new ReconnectController(reconnect, restore, { onState, onRetry })

    controller.start(4)
    expect(onState).toHaveBeenCalledWith('reconnecting', 4)

    await vi.advanceTimersByTimeAsync(1_200)
    expect(reconnect).toHaveBeenCalledTimes(1)
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 2_400)

    await vi.advanceTimersByTimeAsync(2_400)
    expect(reconnect).toHaveBeenCalledTimes(2)
    expect(restore).toHaveBeenCalledTimes(1)
    expect(onState).not.toHaveBeenCalledWith('connected', expect.anything())

    resolveRestore(5)
    await vi.runAllTicks()
    expect(onState).toHaveBeenLastCalledWith('connected', 5)
    expect(controller.isActive).toBe(false)
  })

  it('cancels pending retries and ignores duplicate starts', async () => {
    vi.useFakeTimers()
    const reconnect = vi.fn().mockRejectedValue(new Error('offline'))
    const onState = vi.fn()
    const controller = new ReconnectController(reconnect, async () => 1, { onState })

    controller.start(0)
    controller.start(0)
    expect(onState).toHaveBeenCalledTimes(1)
    controller.cancel()
    await vi.runAllTimersAsync()

    expect(reconnect).not.toHaveBeenCalled()
    expect(controller.isActive).toBe(false)
  })
})
