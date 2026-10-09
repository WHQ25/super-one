import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UsageThrottle } from './throttle'

describe('UsageThrottle', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0) })
  afterEach(() => vi.useRealTimers())

  it('reads upstream at most once per interval unless forced', async () => {
    const throttle = new UsageThrottle<number>(60_000)
    const fetch = vi.fn(async () => ({ value: fetch.mock.calls.length }))
    expect(await throttle.read('k', 'a', false, fetch)).toEqual({ value: 1 })
    vi.setSystemTime(30_000)
    expect(await throttle.read('k', 'a', false, fetch)).toEqual({ value: 1 })
    expect(await throttle.read('k', 'a', true, fetch)).toEqual({ value: 2 })
  })

  it('keeps the last value through a failure and a 429 backoff', async () => {
    const throttle = new UsageThrottle<number>(0, 300_000)
    await throttle.read('k', 'a', false, async () => ({ value: 7 }))
    expect(await throttle.read('k', 'a', false, async () => ({ error: 'HTTP 500' }))).toEqual({ value: 7, error: 'HTTP 500' })
    const fetch = vi.fn(async () => ({ rateLimitedForMs: 0 }))
    expect((await throttle.read('k', 'a', false, fetch)).value).toBe(7)
    vi.setSystemTime(100_000)
    await throttle.read('k', 'a', true, fetch)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('never hands one login another login\'s numbers', async () => {
    const throttle = new UsageThrottle<number>(60_000)
    await throttle.read('k', 'alice', false, async () => ({ value: 1 }))
    expect(await throttle.read('k', 'bob', false, async () => ({ error: 'offline' }))).toEqual({ value: null, error: 'offline' })
  })
})
