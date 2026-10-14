import { afterEach, describe, expect, it, vi } from 'vitest'
import { readAccountUsage, readRateLimits } from './codex-admin'

afterEach(() => vi.useRealTimers())

function fixture(scope: string) {
  let email = `${scope}@example.test`
  const limits = vi.fn(async () => ({ rateLimits: { primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: null } } }))
  const usage = vi.fn(async () => ({ lifetimeTokens: 12000 }))
  const client = { request: vi.fn(async (method: string): Promise<Record<string, unknown>> => method === 'account/read'
    ? { account: { type: 'chatgpt', email, planType: 'plus' } }
    : method === 'account/rateLimits/read' ? limits() : usage()) }
  return { client, limits, usage, switchAccount: () => { email = `other-${email}` } }
}

describe('Codex usage refresh', () => {
  it('throttles automatic reads for five minutes, preserves source time and allows manual refresh', async () => {
    vi.useFakeTimers()
    const { client, limits } = fixture('throttle')
    const first = await readRateLimits(client, 'throttle')
    vi.advanceTimersByTime(60_000)
    expect(await readRateLimits(client, 'throttle')).toEqual(first)
    expect(limits).toHaveBeenCalledTimes(1)
    const refreshed = await readRateLimits(client, 'throttle', true)
    expect(refreshed?.fetchedAt).toBe(Date.now())
    expect(limits).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(5 * 60_000)
    await readRateLimits(client, 'throttle')
    expect(limits).toHaveBeenCalledTimes(3)
  })

  it('coalesces overlapping reads and retains the last reading after a failed refresh', async () => {
    vi.useFakeTimers()
    const { client, limits } = fixture('failure')
    const readings = await Promise.all([readRateLimits(client, 'failure'), readRateLimits(client, 'failure', true)])
    expect(limits).toHaveBeenCalledTimes(1)
    expect(readings[1]).toEqual(readings[0])
    limits.mockRejectedValueOnce(new Error('Network unavailable'))
    vi.advanceTimersByTime(5 * 60_000)
    const stale = await readRateLimits(client, 'failure')
    expect(stale?.primary).toEqual(readings[0]?.primary)
    expect(stale?.fetchedAt).toBe(readings[0]?.fetchedAt)
    expect(stale?.error).toContain('Network unavailable')
    await readRateLimits(client, 'failure')
    expect(limits).toHaveBeenCalledTimes(2)
  })

  it('does not let a manual refresh bypass a 429 backoff', async () => {
    vi.useFakeTimers()
    const { client, limits } = fixture('backoff')
    const first = await readRateLimits(client, 'backoff')
    limits.mockRejectedValueOnce(new Error('unexpected status 429 Too Many Requests'))
    const stale = await readRateLimits(client, 'backoff', true)
    expect(stale?.fetchedAt).toBe(first?.fetchedAt)
    expect(stale?.error).toContain('Rate limited')
    await readRateLimits(client, 'backoff', true)
    expect(limits).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(5 * 60_000)
    await readRateLimits(client, 'backoff', true)
    expect(limits).toHaveBeenCalledTimes(3)
  })

  it('never carries a previous account reading into a changed login', async () => {
    const { client, limits, switchAccount } = fixture('identity')
    const first = await readRateLimits(client, 'identity')
    switchAccount()
    const next = await readRateLimits(client, 'identity')
    expect(next?.quotaKey).not.toBe(first?.quotaKey)
    expect(limits).toHaveBeenCalledTimes(2)
    switchAccount()
    limits.mockRejectedValueOnce(new Error('Offline'))
    await expect(readRateLimits(client, 'identity')).rejects.toThrow('Offline')
  })

  it('throttles account statistics independently for each thread and supports manual refresh', async () => {
    const { client, usage } = fixture('statistics')
    await readAccountUsage(client, 'thread-a', 'statistics')
    await readAccountUsage(client, 'thread-a', 'statistics')
    expect(usage).toHaveBeenCalledTimes(1)
    await readAccountUsage(client, 'thread-b', 'statistics')
    expect(usage).toHaveBeenCalledTimes(2)
    await readAccountUsage(client, 'thread-b', 'statistics', true)
    expect(usage).toHaveBeenCalledTimes(3)
  })

  it('fences a delayed reading across an account change', async () => {
    const { client, limits, switchAccount } = fixture('delayed')
    let finish!: (value: { rateLimits: { primary: { usedPercent: number; windowDurationMins: number; resetsAt: null } } }) => void
    limits.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const oldReading = readRateLimits(client, 'delayed')
    await vi.waitFor(() => expect(limits).toHaveBeenCalledTimes(1))
    switchAccount()
    const next = await readRateLimits(client, 'delayed')
    finish({ rateLimits: { primary: { usedPercent: 90, windowDurationMins: 300, resetsAt: null } } })
    await oldReading
    expect((await readRateLimits(client, 'delayed'))?.primary?.usedPercent).toBe(next?.primary?.usedPercent)
    expect(limits).toHaveBeenCalledTimes(2)
  })

  it('clears the displayed reading after sign-out instead of serving cached quota', async () => {
    const { client, limits } = fixture('logout')
    await readRateLimits(client, 'logout')
    client.request.mockImplementation(async () => ({ account: null }))
    expect(await readRateLimits(client, 'logout')).toBeNull()
    expect(limits).toHaveBeenCalledTimes(1)
  })

  it('uses cached quota and statistics on page open even after their automatic interval expires', async () => {
    vi.useFakeTimers()
    const { client, limits, usage } = fixture('page-cache')
    const first = await readRateLimits(client, 'page-cache', false, true)
    await readAccountUsage(client, null, 'page-cache', false, true)
    vi.advanceTimersByTime(10 * 60_000)
    expect(await readRateLimits(client, 'page-cache', false, true)).toEqual(first)
    await readAccountUsage(client, null, 'page-cache', false, true)
    expect(limits).toHaveBeenCalledTimes(1)
    expect(usage).toHaveBeenCalledTimes(1)
  })
})
