import { describe, expect, it } from 'vitest'
import { SubscriptionUsageTracker, usageRisk, usageWindowTone, type UsageWindow } from './subscription-usage'
import { usageForecastCopy } from './subscription-usage-presentation'

const now = Date.UTC(2026, 8, 30, 12)
const input = (usedPercent = 40): UsageWindow => ({ id: '5h', label: '5h', usedPercent, windowDurationMins: 300, resetsAt: now / 1000 + 3 * 3600 })
const observe = (used: number) => new SubscriptionUsageTracker().observe('a', input(used), now)

describe('OpenUsage cycle-average pacing', () => {
  it('always uses the cycle average, including after many samples and inactivity', () => {
    const tracker = new SubscriptionUsageTracker()
    let window = tracker.observe('a', input(), now)
    expect(window.forecast).toMatchObject({ basis: 'cycle-average', ratePerHour: 20, exhaustsAt: now + 3 * 3600_000, confirmed: false })
    for (let m = 5; m <= 30; m += 5) window = tracker.observe('a', input(40 + m / 5), now + m * 60_000)
    expect(window.forecast?.ratePerHour).toBeCloseTo(46 / 2.5)
    expect(window.forecast?.confirmed).toBe(true)
    window = tracker.observe('a', input(46), now + 60 * 60_000)
    expect(window.forecast?.status).toBe('ready')
    expect(window.forecast?.ratePerHour).toBeCloseTo(46 / 3)
  })
  it('waits for max(one minute, one percent of the period)', () => {
    for (const duration of [30, 300, 10080]) {
      const minimum = Math.max(60_000, duration * 60_000 * 0.01)
      for (const elapsed of [minimum - 1, minimum]) {
        const window = new SubscriptionUsageTracker().observe('a', { ...input(1), windowDurationMins: duration,
          resetsAt: (now + duration * 60_000 - elapsed) / 1000 }, now)
        expect(window.forecast?.status).toBe(elapsed < minimum ? 'learning' : 'ready')
      }
    }
  })
  it('requires valid usage, duration and an active cycle', () => {
    for (const window of [input(0), input(-1), input(101), input(NaN), { ...input(), windowDurationMins: undefined },
      { ...input(), resetsAt: null }, { ...input(), resetsAt: now / 1000 }, { ...input(), resetsAt: now / 1000 + 6 * 3600 }]) {
      const result = new SubscriptionUsageTracker().observe('a', window, now)
      expect(result.forecast?.status).toBe('learning')
      expect(usageForecastCopy(result, now)).toBeNull()
    }
  })
  it('matches projected 90% and 100% color boundaries', () => {
    for (const [used, risk, tone] of [[36, 'safe', 'success'], [38, 'watch', 'warning'], [40, 'watch', 'warning'],
      [41, 'watch', 'warning'], [95, 'critical', 'error'], [100, 'exhausted', 'error']] as const) {
      const window = observe(used)
      expect(usageRisk(window, now)).toBe(risk)
      expect(usageWindowTone(window, now)).toBe(tone)
    }
  })
  it('turns red only when exhaustion is within a tenth of the period', () => {
    // On-pace early burst: 12% after 34 minutes of a 5h window runs out minutes before reset.
    const early = new SubscriptionUsageTracker().observe('a', { ...input(12), resetsAt: (now + 266 * 60_000) / 1000 }, now)
    expect(usageRisk(early, now)).toBe('watch')
    const weekly = (used: number) => new SubscriptionUsageTracker().observe('a',
      { ...input(used), windowDurationMins: 10080, resetsAt: (now + 48 * 3600_000) / 1000 }, now)
    expect(usageRisk(weekly(80), now)).toBe('watch')
    expect(usageRisk(weekly(90), now)).toBe('risk')
  })
  it('shows the ETA only strictly before reset', () => {
    for (const used of [36, 38, 40]) expect(usageForecastCopy(observe(used), now)).toBeNull()
    expect(usageForecastCopy(observe(60), now)).toEqual({ key: 'eta', time: '1h 20m' })
    expect(usageForecastCopy(observe(100), now)).toEqual({ key: 'exhausted' })
  })
  it('isolates accounts and windows; cached and rapid readings cannot confirm', () => {
    const tracker = new SubscriptionUsageTracker()
    tracker.observe('a', input(60), now)
    expect(tracker.observe('a', input(80), now).usedPercent).toBe(60)
    expect(tracker.observe('a', input(60), now + 30_000).forecast?.confirmed).toBe(false)
    expect(tracker.observe('a', input(60), now + 60_000).forecast?.confirmed).toBe(true)
    expect(tracker.observe('b', input(60), now + 60_000).forecast?.confirmed).toBe(false)
    expect(tracker.observe('a', { ...input(60), id: 'other' }, now + 60_000).forecast?.confirmed).toBe(false)
    expect(tracker.observe('a', input(30), now + 120_000).forecast?.confirmed).toBe(false)
    expect(tracker.observe('a', { ...input(), resetsAt: input().resetsAt! + 300 * 60 }, now + 180_000).forecast?.confirmed).toBe(false)
  })
  it('expires old readings', () => {
    expect(usageRisk(observe(60), now + 11 * 60_000)).toBe('unknown')
    expect(usageForecastCopy(observe(60), now + 11 * 60_000)).toEqual({ key: 'stale' })
  })
})
