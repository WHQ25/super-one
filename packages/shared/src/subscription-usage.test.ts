import { describe, expect, it } from 'vitest'
import { SubscriptionUsageTracker, usageRisk, usageWindowTone, type UsageWindow } from './subscription-usage'

const now = Date.UTC(2026, 8, 30, 12)
function series(rate: number, remaining: number, resetHours: number, tracker = new SubscriptionUsageTracker(), key = 'account-a'): UsageWindow {
  let result: UsageWindow = { id: 'weekly', label: 'Weekly', usedPercent: 0, resetsAt: (now + resetHours * 3_600_000) / 1000 }
  for (let minute = -60; minute <= 0; minute += 5) {
    result = tracker.observe(key, { ...result, usedPercent: 100 - remaining + minute / 60 * rate }, now + minute * 60_000)
  }
  return result
}

describe('subscription runway', () => {
  it('keeps 20% remaining calm when the weekly quota resets in half an hour', () => {
    const window = series(5, 20, 0.5)
    expect(window.forecast?.ratePerHour).toBeCloseTo(5)
    expect(window.forecast?.exhaustsAt).toBeCloseTo(now + 4 * 3_600_000)
    expect(window.forecast?.confirmed).toBe(true)
    expect(usageRisk(window, now)).toBe('safe')
    expect(usageWindowTone(window, now)).toBe('success')
  })
  it('warns when the same 20% will run out before reset, even far above a fixed percentage threshold', () => {
    expect(usageRisk(series(10, 20, 48), now)).toBe('risk')
    expect(usageRisk(series(60, 30, 4), now)).toBe('critical')
    expect(usageRisk(series(1, 5, 1 / 6), now)).toBe('safe')
  })
  it('does not call an old reading safe or hide its age', () => {
    const window = series(5, 20, 0.5)
    expect(usageRisk(window, now + 11 * 60_000)).toBe('unknown')
    expect(usageWindowTone(window, now + 11 * 60_000)).toBe('muted')
  })
  it('starts learning again after a reset, account switch, usage correction or offline gap', () => {
    for (const change of ['reset', 'account', 'correction', 'gap'] as const) {
      const tracker = new SubscriptionUsageTracker()
      const window = series(5, 20, 48, tracker)
      const next = tracker.observe(change === 'account' ? 'b' : 'account-a', {
        ...window, usedPercent: change === 'correction' ? 30 : 81,
        resetsAt: window.resetsAt! + (change === 'reset' ? 7 * 86400 : 0),
      }, now + (change === 'gap' ? 16 : 5) * 60_000)
      expect(next.forecast?.status).toBe('learning')
    }
  })
  it('does not learn from cached reads or rapid refreshes', () => {
    const tracker = new SubscriptionUsageTracker()
    const window: UsageWindow = { label: 'Weekly', usedPercent: 80, resetsAt: now / 1000 + 3600 }
    for (let i = 0; i < 20; i++) expect(tracker.observe('a', window, now + i * 1000).forecast?.status).toBe('learning')
  })
  it('keeps flat intervals and stops projecting after sustained inactivity', () => {
    const tracker = new SubscriptionUsageTracker()
    let window = series(10, 20, 48, tracker)
    for (let m = 5; m <= 25; m += 5) window = tracker.observe('account-a', window, now + m * 60_000)
    expect(window.forecast?.status).toBe('idle')
    expect(window.forecast?.exhaustsAt).toBeNull()
  })
  it('reacts to an acceleration and keeps windows independent', () => {
    const tracker = new SubscriptionUsageTracker()
    let window = series(2, 40, 48, tracker)
    window = tracker.observe('account-a', { ...window, usedPercent: 70 }, now + 5 * 60_000)
    expect(window.forecast!.ratePerHour!).toBeGreaterThan(20)
    expect(tracker.observe('account-a', { ...window, id: '5h', label: '5h' }, now + 5 * 60_000).forecast?.status).toBe('learning')
  })
})
