import { describe, expect, it, vi } from 'vitest'
import { pollUntilDone } from './poll'
import type { VideoTask } from './ark/response'

function task(status: VideoTask['status'], extra: Partial<VideoTask> = {}): VideoTask {
  return { id: 't', status, ...extra }
}

/** Drives the poller on a virtual clock so tests never wait on real time. */
function fakeClock() {
  let current = 0
  return {
    now: () => current,
    sleep: async (ms: number) => {
      current += ms
    },
    elapsed: () => current,
  }
}

describe('pollUntilDone', () => {
  it('returns immediately when the first check is already terminal', async () => {
    const clock = fakeClock()
    const check = vi.fn().mockResolvedValue(task('succeeded', { videoUrl: 'u' }))
    const result = await pollUntilDone(check, clock)
    expect(result.status).toBe('succeeded')
    expect(check).toHaveBeenCalledTimes(1)
    expect(clock.elapsed()).toBe(0)
  })

  it('keeps polling while the task is pending', async () => {
    const clock = fakeClock()
    const check = vi
      .fn()
      .mockResolvedValueOnce(task('queued'))
      .mockResolvedValueOnce(task('running'))
      .mockResolvedValue(task('succeeded', { videoUrl: 'u' }))
    const result = await pollUntilDone(check, clock)
    expect(result.status).toBe('succeeded')
    expect(check).toHaveBeenCalledTimes(3)
  })

  it('backs off between polls up to the ceiling', async () => {
    const clock = fakeClock()
    const delays: number[] = []
    const spied = {
      ...clock,
      sleep: async (ms: number) => {
        delays.push(ms)
        await clock.sleep(ms)
      },
    }
    let calls = 0
    await pollUntilDone(
      async () => (++calls < 6 ? task('running') : task('succeeded', { videoUrl: 'u' })),
      { ...spied, intervalMs: 1000, maxIntervalMs: 4000 },
    )
    expect(delays).toEqual([1000, 2000, 4000, 4000, 4000])
  })

  it('returns a failed task when the deadline passes', async () => {
    const clock = fakeClock()
    const result = await pollUntilDone(async () => task('running'), {
      ...clock,
      intervalMs: 1000,
      maxIntervalMs: 1000,
      timeoutMs: 3000,
    })
    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/timed out/i)
  })

  it('stops when the abort signal fires', async () => {
    const clock = fakeClock()
    const controller = new AbortController()
    let calls = 0
    const result = await pollUntilDone(
      async () => {
        if (++calls === 2) controller.abort()
        return task('running')
      },
      { ...clock, intervalMs: 10, abortSignal: controller.signal },
    )
    expect(result.status).toBe('cancelled')
    expect(calls).toBe(2)
  })

  it('propagates a terminal failure from the check', async () => {
    const clock = fakeClock()
    const result = await pollUntilDone(async () => task('failed', { error: 'nope' }), clock)
    expect(result).toMatchObject({ status: 'failed', error: 'nope' })
  })

  it('does not swallow a thrown transport error', async () => {
    const clock = fakeClock()
    await expect(
      pollUntilDone(async () => {
        throw new Error('socket hang up')
      }, clock),
    ).rejects.toThrow('socket hang up')
  })
})
