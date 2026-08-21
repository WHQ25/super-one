import { describe, expect, it } from 'vitest'
import { settle } from './settle'

/**
 * Time is injected rather than faked globally: this loop interleaves awaits with
 * clock reads, and a global fake timer deadlocks that pattern instead of testing it.
 */
function clock() {
  let current = 0
  return {
    now: () => current,
    sleep: async (ms: number) => { current += ms },
    advance: (ms: number) => { current += ms },
  }
}

describe('settle', () => {
  it('settles on the second sample when the screen is already still', async () => {
    const time = clock()
    let calls = 0
    const result = await settle(
      async () => { calls++; return 'still' },
      (value) => value,
      { now: time.now, sleep: time.sleep },
    )
    expect(result.settled).toBe(true)
    expect(result.samples).toBe(2)
    expect(calls).toBe(2)
  })

  it('keeps sampling while the screen is moving, then settles', async () => {
    const time = clock()
    const frames = ['a', 'b', 'c', 'd', 'd']
    let index = 0
    const result = await settle(
      async () => frames[Math.min(index++, frames.length - 1)]!,
      (value) => value,
      { now: time.now, sleep: time.sleep },
    )
    expect(result.settled).toBe(true)
    expect(result.value).toBe('d')
    expect(result.samples).toBe(5)
  })

  it('gives up on a screen that never repeats, without throwing', async () => {
    // A spinner, a video, a live camera: reporting unsettled is the correct outcome,
    // because failing here would make those screens untestable entirely.
    const time = clock()
    let tick = 0
    const result = await settle(
      async () => `frame-${tick++}`,
      (value) => value,
      { now: time.now, sleep: time.sleep, timeoutMs: 500, intervalMs: 100 },
    )
    expect(result.settled).toBe(false)
    expect(result.value).toBe('frame-5')
  })

  it('returns the freshest sample even when it times out', async () => {
    const time = clock()
    let tick = 0
    const result = await settle(
      async () => tick++,
      (value) => String(value),
      { now: time.now, sleep: time.sleep, timeoutMs: 200, intervalMs: 100 },
    )
    expect(result.settled).toBe(false)
    expect(result.value).toBe(result.samples - 1)
  })

  it('can demand more than two identical samples', async () => {
    const time = clock()
    // Flickers once after appearing to be stable — one repeat would be fooled.
    const frames = ['a', 'a', 'b', 'a', 'a', 'a']
    let index = 0
    const result = await settle(
      async () => frames[Math.min(index++, frames.length - 1)]!,
      (value) => value,
      { now: time.now, sleep: time.sleep, stableSamples: 3, timeoutMs: 10_000 },
    )
    expect(result.settled).toBe(true)
    expect(result.samples).toBe(6)
  })

  it('never accepts a single sample as proof of stillness', async () => {
    const time = clock()
    let calls = 0
    await settle(
      async () => { calls++; return 'x' },
      (value) => value,
      { now: time.now, sleep: time.sleep, stableSamples: 1 },
    )
    expect(calls).toBeGreaterThanOrEqual(2)
  })

  it('interrupts the wait between samples when aborted', async () => {
    const controller = new AbortController()
    const pending = settle(
      async () => 'still',
      (value) => value,
      {
        signal: controller.signal,
        sleep: () => new Promise<void>(() => {}),
      },
    )
    await Promise.resolve()
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
