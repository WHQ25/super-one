import { describe, expect, it } from 'vitest'
import { availableResetGrants, extraUsageCopy } from './subscription-usage-presentation'

describe('extraUsageCopy', () => {
  it('shows spend against a cap with the spent share, clamped at 100', () => {
    expect(extraUsageCopy({ usedDollars: 3.25, limitDollars: 50 })).toEqual({ value: '$3.25 / $50.00', usedPercent: 6.5 })
    expect(extraUsageCopy({ usedDollars: 60, limitDollars: 50 }).usedPercent).toBe(100)
  })

  it('shows uncapped spend without a share', () => {
    expect(extraUsageCopy({ usedDollars: 1.2, limitDollars: null })).toEqual({ value: '$1.20', usedPercent: null })
  })
})

describe('availableResetGrants', () => {
  const now = Date.parse('2026-10-19T00:00:00Z')
  const at = (iso: string) => Date.parse(iso) / 1000

  it('counts resets of unexpired grants and reports the soonest deadline', () => {
    expect(availableResetGrants([
      { resetsLeft: 2, expiresAt: at('2026-10-30T00:00:00Z') },
      { resetsLeft: 1, expiresAt: at('2026-10-22T00:00:00Z') },
      { resetsLeft: 1, expiresAt: null },
      { resetsLeft: 3, expiresAt: at('2026-10-18T00:00:00Z') },
    ], now)).toEqual({ count: 4, nextExpiresAt: at('2026-10-22T00:00:00Z') })
  })

  it('is null when nothing is usable', () => {
    expect(availableResetGrants(undefined, now)).toBeNull()
    expect(availableResetGrants([{ resetsLeft: 1, expiresAt: at('2026-10-01T00:00:00Z') }], now)).toBeNull()
  })
})
