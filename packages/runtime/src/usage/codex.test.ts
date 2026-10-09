import { describe, expect, it } from 'vitest'
import { codexPlanName, codexWindowLabel, parseCodexUsage } from './codex'

describe('codexWindowLabel', () => {
  it('names windows by duration like the desktop gauge', () => {
    expect(codexWindowLabel(300)).toBe('5h')
    expect(codexWindowLabel(10_080)).toBe('7d')
    expect(codexWindowLabel(30)).toBe('30m')
    expect(codexWindowLabel(null)).toBe('Usage')
  })
})

describe('parseCodexUsage', () => {
  it('labels each window by its length and resolves relative resets', () => {
    const limits = parseCodexUsage({
      plan_type: 'prolite',
      rate_limit: {
        primary_window: { used_percent: 12, limit_window_seconds: 18_000, reset_after_seconds: 600 },
        secondary_window: { used_percent: 88, limit_window_seconds: 604_800, reset_at: 1_791_954_559 },
      },
    }, 1_000)
    expect(limits).toEqual({
      planType: 'Pro 100',
      extraUsage: null,
      windows: [
        { label: '5h', usedPercent: 12, resetsAt: 1_600 },
        { label: '7d', usedPercent: 88, resetsAt: 1_791_954_559 },
      ],
    })
  })

  it('skips a window Codex removed and rejects a body without rate limits', () => {
    expect(parseCodexUsage({ rate_limit: { primary_window: null, secondary_window: { used_percent: 5 } } })?.windows).toEqual([{ label: 'Usage', usedPercent: 5, resetsAt: null }])
    expect(parseCodexUsage({ plan_type: 'pro' })).toBeNull()
  })

  it('names plans as they are sold', () => {
    expect(codexPlanName('pro')).toBe('Pro 200')
    expect(codexPlanName('self_serve_business_usage_based')).toBe('Self Serve Business Usage Based')
    expect(codexPlanName('')).toBeNull()
  })
})
