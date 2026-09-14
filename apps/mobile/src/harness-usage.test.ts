import { describe, expect, it, vi } from 'vitest'
import type { RelayClient } from '@superone/relay-client'
import type { RemoteUsage } from '@superone/shared/agent-types'
import { activeRateLimit, consumeRateLimitReset, fetchHarnessUsage, formatResetIn, remainingPercent, updatedAgoMinutes, usageBadgeWindow, usageIsStale, usageTargetKey, usageTone, USAGE_STALE_MS, type UsageTarget } from './harness-usage'

const target: UsageTarget = { projectPath: '/p', provider: 'claude', sessionId: 's1', apiProviderId: null, acpAgentId: null }

const usage: RemoteUsage = {
  kind: 'claude', title: 'Claude', account: 'a@x.io', planType: 'Max', extraUsage: null, fetchedAt: 10_000,
  windows: [{ label: 'Weekly', usedPercent: 20, resetsAt: null }, { label: '5h', usedPercent: 63.4, resetsAt: null }],
}

describe('fetchHarnessUsage', () => {
  it('sends the target as a get_usage command and unwraps the meter', async () => {
    const request = vi.fn(async () => ({ usage }))
    const client = { request } as unknown as RelayClient
    await expect(fetchHarnessUsage(client, target, true)).resolves.toEqual(usage)
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ type: 'get_usage', ...target, force: true }))
  })

  it('reads a host error, a transport failure and an absent meter all as null', async () => {
    const error = { request: async () => ({ error: 'nope' }) } as unknown as RelayClient
    const thrown = { request: async () => { throw new Error('offline') } } as unknown as RelayClient
    const empty = { request: async () => ({ usage: null }) } as unknown as RelayClient
    await expect(fetchHarnessUsage(error, target)).resolves.toBeNull()
    await expect(fetchHarnessUsage(thrown, target)).resolves.toBeNull()
    await expect(fetchHarnessUsage(empty, target)).resolves.toBeNull()
  })
})

describe('usageTargetKey', () => {
  it('ignores the session so switching chats on one credential keeps the reading', () => {
    expect(usageTargetKey(target)).toBe(usageTargetKey({ ...target, sessionId: 's2' }))
    expect(usageTargetKey(target)).not.toBe(usageTargetKey({ ...target, apiProviderId: 'glm' }))
    expect(usageTargetKey(null)).toBeNull()
  })
})

describe('usageIsStale', () => {
  it('treats a missing reading or a missing timestamp as stale', () => {
    expect(usageIsStale(null)).toBe(true)
    expect(usageIsStale({ ...usage, fetchedAt: null })).toBe(true)
  })

  it('turns stale once the host reading is older than the panel threshold', () => {
    expect(usageIsStale(usage, 10_000 + USAGE_STALE_MS)).toBe(false)
    expect(usageIsStale(usage, 10_001 + USAGE_STALE_MS)).toBe(true)
  })
})

describe('usageBadgeWindow', () => {
  it('prefers the 5h window and falls back to the first', () => {
    expect(usageBadgeWindow(usage)?.label).toBe('5h')
    expect(usageBadgeWindow({ ...usage, windows: usage.windows.slice(0, 1) })?.label).toBe('Weekly')
    expect(usageBadgeWindow(null)).toBeNull()
  })
})

describe('remainingPercent', () => {
  it('rounds and clamps the remaining share', () => {
    expect(remainingPercent(63.4)).toBe(37)
    expect(remainingPercent(120)).toBe(0)
    expect(remainingPercent(-5)).toBe(100)
  })
})

describe('consumeRateLimitReset', () => {
  it('names the credential and credit, and unwraps the outcome', async () => {
    const request = vi.fn(async () => ({ outcome: 'reset' }))
    const client = { request } as unknown as RelayClient
    await expect(consumeRateLimitReset(client, target, 'rc-1')).resolves.toBe('reset')
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ type: 'consume_rate_limit_reset', projectPath: '/p', apiProviderId: null, creditId: 'rc-1' }))
  })

  it('reads a host error or transport failure as null', async () => {
    await expect(consumeRateLimitReset({ request: async () => ({ error: 'x' }) } as unknown as RelayClient, target)).resolves.toBeNull()
    await expect(consumeRateLimitReset({ request: async () => { throw new Error('offline') } } as unknown as RelayClient, target)).resolves.toBeNull()
  })
})

describe('usageTone', () => {
  it('follows the desktop gauge thresholds on the remaining share', () => {
    expect(usageTone(0)).toBe('success')
    expect(usageTone(69)).toBe('success')
    expect(usageTone(70)).toBe('warning')
    expect(usageTone(90)).toBe('error')
  })
})

describe('formatResetIn', () => {
  const now = 1_700_000_000_000
  it('renders the largest two units and marks a passed reset as soon', () => {
    expect(formatResetIn(null, now)).toBeNull()
    expect(formatResetIn(now / 1000 - 1, now)).toBe('soon')
    expect(formatResetIn(now / 1000 + 30, now)).toBe('1m')
    expect(formatResetIn(now / 1000 + 2 * 3600 + 15 * 60, now)).toBe('2h 15m')
    expect(formatResetIn(now / 1000 + 3 * 86_400 + 3600, now)).toBe('3d 1h')
    expect(formatResetIn(now / 1000 + 86_400, now)).toBe('1d')
  })
})

describe('updatedAgoMinutes', () => {
  it('floors to whole minutes and never goes negative', () => {
    expect(updatedAgoMinutes(null)).toBeNull()
    expect(updatedAgoMinutes(10_000, 10_000 + 3 * 60_000 + 59_000)).toBe(3)
    expect(updatedAgoMinutes(20_000, 10_000)).toBe(0)
  })
})

describe('activeRateLimit', () => {
  it('drops a warning once its reset has passed and keeps one without a reset', () => {
    const now = 1_700_000_000_000
    expect(activeRateLimit({ status: 'rejected', resetsAt: now / 1000 - 1 }, now)).toBeNull()
    expect(activeRateLimit({ status: 'rejected', resetsAt: now / 1000 + 60 }, now)).toMatchObject({ status: 'rejected' })
    expect(activeRateLimit({ status: 'allowed_warning' }, now)).toMatchObject({ status: 'allowed_warning' })
    expect(activeRateLimit(null)).toBeNull()
  })
})
