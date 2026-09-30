import { afterEach, describe, expect, it, vi } from 'vitest'
import { readRateLimits } from './codex-admin'
import { usageRisk } from '@superone/shared/subscription-usage'

afterEach(() => vi.useRealTimers())

describe('Codex subscription readings', () => {
  it('shares source observations across callers, preserves timestamps and isolates account changes', async () => {
    vi.useFakeTimers()
    const start = Date.UTC(2026, 8, 30)
    let usedPercent = 70
    let email = 'usage-a@example.test'
    const client = { request: vi.fn(async (method: string) => method === 'account/read'
      ? { account: { type: 'chatgpt', email, planType: 'plus' } }
      : { rateLimits: { primary: { usedPercent, windowDurationMins: 300, resetsAt: start / 1000 + 7200 }, planType: 'plus' } }) }
    let limits = null
    for (let m = 0; m <= 25; m += 5) {
      vi.setSystemTime(start + m * 60_000)
      usedPercent = 70 + m
      limits = await readRateLimits(client, 'profile-a')
    }
    expect(limits?.fetchedAt).toBe(Date.now())
    expect(limits?.primary?.forecast?.confirmed).toBe(true)
    expect(usageRisk(limits!.primary!)).toBe('critical')
    const key = limits?.quotaKey
    email = 'usage-b@example.test'
    const switched = await readRateLimits(client, 'profile-a')
    expect(switched?.quotaKey).not.toBe(key)
    expect(switched?.primary?.forecast?.basis).toBe('cycle-average')
    expect(switched?.primary?.forecast?.confirmed).toBe(false)
  })

  it('keeps limits available when an older server cannot identify the account', async () => {
    const client = { request: vi.fn(async (method: string) => {
      if (method === 'account/read') throw new Error('unsupported')
      return { primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: null } }
    }) }
    const limits = await readRateLimits(client)
    expect(limits?.primary?.usedPercent).toBe(25)
    expect(limits?.primary?.forecast).toBeUndefined()
    expect(limits?.fetchedAt).toEqual(expect.any(Number))
  })
})
