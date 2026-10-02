import { describe, expect, it } from 'vitest'
import { SubscriptionAlertLedger, relevantUsageLimit, selectSubscriptionAlert, type LiveUsageLimit, type SubscriptionAlert } from './subscription-alerts'
import type { UsageWindow } from './subscription-usage'

const now = Date.UTC(2026, 8, 30, 12)
const safe: UsageWindow = { id: 'seven_day', label: 'Weekly', usedPercent: 80, resetsAt: now / 1000 + 1800,
  forecast: { sampledAt: now, status: 'ready', periodMs: 7 * 86_400_000, ratePerHour: 5, exhaustsAt: now + 4 * 3_600_000, confirmed: true } }
const warning: LiveUsageLimit = { status: 'allowed_warning', rateLimitType: 'seven_day', utilization: 0.8, resetsAt: safe.resetsAt! }

describe('subscription alerts', () => {
  it('suppresses the weekly warning only when the matching forecast reliably lasts until reset', () => {
    expect(selectSubscriptionAlert([safe], warning, now)).toBeNull()
    expect(relevantUsageLimit(warning, [{ ...safe, forecast: { ...safe.forecast!, confirmed: false } }], now)).toBe(warning)
    expect(relevantUsageLimit(warning, [safe], now + 11 * 60_000)).toBe(warning)
  })
  it('does not hide a rejection, a newer consumption spike or an unrelated window warning', () => {
    expect(selectSubscriptionAlert([safe], { ...warning, status: 'rejected' }, now)?.severity).toBe(3)
    expect(selectSubscriptionAlert([safe], { ...warning, utilization: 0.95 }, now)?.source).toBe('provider')
    expect(selectSubscriptionAlert([safe], { ...warning, resetsAt: now / 1000 + 86400 }, now)?.source).toBe('provider')
    expect(selectSubscriptionAlert([safe], { ...warning, rateLimitType: 'five_hour', resetsAt: now / 1000 + 7200 }, now)?.source).toBe('provider')
  })
  it('does not guess the quota when multiple model windows share the reset time', () => {
    const ambiguous = { ...warning, rateLimitType: undefined }
    expect(relevantUsageLimit(ambiguous, [safe, { ...safe, id: 'seven_day_sonnet' }], now)).toBe(ambiguous)
    expect(relevantUsageLimit(ambiguous, [{ ...safe, id: undefined }, { ...safe, id: undefined, model: 'sonnet' }], now)).toBe(ambiguous)
  })
  it('only predicts an interruption for model-specific pools when that model is selected', () => {
    const sonnet = { ...safe, id: 'seven_day_sonnet', model: 'sonnet', resetsAt: now / 1000 + 86400 }
    expect(selectSubscriptionAlert([sonnet], null, now, 'claude-opus')).toBeNull()
    expect(selectSubscriptionAlert([sonnet], null, now, 'claude-sonnet-4-6')?.windowId).toBe('seven_day_sonnet')
  })
  it('selects the earliest confirmed forecast once, even without a provider warning', () => {
    const later = { ...safe, resetsAt: now / 1000 + 86400, forecast: { ...safe.forecast!, exhaustsAt: now + 7200_000 } }
    const earlier = { ...later, id: 'five_hour', label: '5h', forecast: { ...later.forecast, exhaustsAt: now + 1200_000 } }
    expect(selectSubscriptionAlert([later, earlier], null, now)).toMatchObject({ windowId: 'five_hour', severity: 2, source: 'forecast' })
  })
  it('deduplicates across sessions and percentage changes, but allows escalation and the next reset', () => {
    const ledger = new SubscriptionAlertLedger()
    const alert = selectSubscriptionAlert([], warning, now) as SubscriptionAlert
    expect(ledger.claim('account-a', alert, now)).toBe(true)
    expect(ledger.claim('account-a', { ...alert, utilization: 0.9 }, now + 5000)).toBe(false)
    expect(ledger.claim('account-b', alert, now + 5000)).toBe(true)
    expect(ledger.claim('account-a', { ...alert, severity: 2 }, now + 10000)).toBe(true)
    expect(ledger.claim('account-a', { ...alert, severity: 3, status: 'rejected' }, now + 11000)).toBe(true)
    expect(ledger.claim('account-a', { ...alert, resetsAt: alert.resetsAt! + 0.1 }, now + 12000)).toBe(false)
    expect(ledger.claim('account-a', { ...alert, resetsAt: alert.resetsAt! + 86400 }, now + 13000)).toBe(true)
  })
  it('only re-arms after sustained reliable recovery, not a data gap or one quiet tick', () => {
    const ledger = new SubscriptionAlertLedger()
    const alert = selectSubscriptionAlert([], warning, now)!
    ledger.claim('a', alert, now)
    ledger.recover('a', [{ ...safe, forecast: undefined }], now + 1000)
    expect(ledger.claim('a', alert, now + 2000)).toBe(false)
    ledger.recover('a', [safe], now + 3000)
    expect(ledger.claim('a', alert, now + 4000)).toBe(false)
    ledger.recover('a', [{ ...safe, resetsAt: now / 1000 + 1800, forecast: { ...safe.forecast!, sampledAt: now + 603000 } }], now + 603000)
    expect(ledger.claim('a', alert, now + 604000)).toBe(true)
  })
})
