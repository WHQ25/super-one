import { describe, expect, it } from 'vitest'
import { parseGrokBilling } from './acp-billing'

/** Verbatim `_x.ai/billing` response from `grok agent stdio` 1.0.0. */
const REAL_RESPONSE = {
  config: {
    creditUsagePercent: 100,
    currentPeriod: {
      type: 'USAGE_PERIOD_TYPE_WEEKLY',
      start: '2026-08-01T21:26:16.084846+00:00',
      end: '2026-08-08T21:26:16.084846+00:00',
    },
    onDemandCap: { val: 0 },
    onDemandUsed: { val: 0 },
    prepaidBalance: { val: 0 },
    isUnifiedBillingUser: true,
    billingPeriodStart: '2026-08-01T21:26:16.084846+00:00',
    billingPeriodEnd: '2026-08-08T21:26:16.084846+00:00',
  },
  subscription_tier: 'SuperGrok Heavy',
}

const PERIOD_END_EPOCH_S = Math.floor(Date.parse('2026-08-08T21:26:16.084846+00:00') / 1000)

describe('parseGrokBilling', () => {
  it('maps a live weekly-pool response onto the shared gauge shape', () => {
    const limits = parseGrokBilling(REAL_RESPONSE)
    expect(limits).toEqual({
      title: 'Grok Build',
      planType: 'SuperGrok Heavy',
      windows: [{ label: 'Weekly limit', usedPercent: 100, resetsAt: PERIOD_END_EPOCH_S }],
      extraUsage: null,
      fetchedAt: expect.any(Number),
    })
  })

  it('unwraps a `result`-wrapped envelope', () => {
    // The agent may answer either shape; the Grok TUI unwraps defensively too.
    expect(parseGrokBilling({ result: REAL_RESPONSE })?.planType).toBe('SuperGrok Heavy')
  })

  it('reports on-demand spend as extra usage once a cap is set', () => {
    const limits = parseGrokBilling({
      config: {
        ...REAL_RESPONSE.config,
        onDemandCap: { val: 2000 },
        onDemandUsed: { val: 550 },
      },
      subscription_tier: 'SuperGrok',
    })
    expect(limits?.extraUsage).toEqual({ usedDollars: 5.5, limitDollars: 20 })
  })

  it('surfaces a remaining prepaid balance', () => {
    const limits = parseGrokBilling({
      config: { ...REAL_RESPONSE.config, prepaidBalance: { val: 1234 } },
    })
    expect(limits?.creditBalanceDollars).toBe(12.34)
  })

  it('derives usage from the legacy limit/used pair when the percent is absent', () => {
    const limits = parseGrokBilling({
      config: {
        monthlyLimit: { val: 2000 },
        used: { val: 500 },
        billingPeriodEnd: '2026-08-08T21:26:16.084846+00:00',
      },
    })
    expect(limits?.windows).toEqual([
      { label: 'Usage', usedPercent: 25, resetsAt: PERIOD_END_EPOCH_S },
    ])
  })

  it('labels a monthly pool from the period type', () => {
    const limits = parseGrokBilling({
      config: {
        creditUsagePercent: 12,
        currentPeriod: { type: 'USAGE_PERIOD_TYPE_MONTHLY', end: '2026-09-01T00:00:00Z' },
      },
    })
    expect(limits?.windows[0]?.label).toBe('Monthly limit')
  })

  it('rejects payloads with no usage signal rather than showing an empty gauge', () => {
    expect(parseGrokBilling({ config: {} })).toBeNull()
    expect(parseGrokBilling({})).toBeNull()
    expect(parseGrokBilling(null)).toBeNull()
  })

  it('maps a live 1.0.4 post-reset payload (camelCase tier, omitted 0%)', () => {
    // Verbatim grok 1.0.4 `_x.ai/billing` after the weekly reset on 2026-08-15.
    const periodEnd = '2026-08-22T21:26:16.084846+00:00'
    const limits = parseGrokBilling({
      config: {
        currentPeriod: {
          type: 'USAGE_PERIOD_TYPE_WEEKLY',
          start: '2026-08-15T21:26:16.084846+00:00',
          end: periodEnd,
        },
        onDemandCap: { val: 0 },
        onDemandUsed: { val: 0 },
        prepaidBalance: { val: 0 },
        isUnifiedBillingUser: true,
        billingPeriodStart: '2026-08-15T21:26:16.084846+00:00',
        billingPeriodEnd: periodEnd,
      },
      subscriptionTier: 'SuperGrok Heavy',
    })
    expect(limits).toMatchObject({
      title: 'Grok Build',
      planType: 'SuperGrok Heavy',
      windows: [{
        label: 'Weekly limit',
        usedPercent: 0,
        resetsAt: Math.floor(Date.parse(periodEnd) / 1000),
      }],
    })
  })

  it('treats an omitted zero percent as 0% when the period is present', () => {
    // Verbatim `_x.ai/billing` after a weekly reset: proto3 drops 0.0
    // `creditUsagePercent`, and the deprecated limit/used pair is also absent.
    const periodEnd = '2026-08-22T21:26:16.084846+00:00'
    const limits = parseGrokBilling({
      config: {
        currentPeriod: {
          type: 'USAGE_PERIOD_TYPE_WEEKLY',
          start: '2026-08-15T21:26:16.084846+00:00',
          end: periodEnd,
        },
        onDemandCap: { val: 0 },
        onDemandUsed: { val: 0 },
        prepaidBalance: { val: 0 },
        isUnifiedBillingUser: true,
        billingPeriodStart: '2026-08-15T21:26:16.084846+00:00',
        billingPeriodEnd: periodEnd,
      },
      subscription_tier: 'SuperGrok Heavy',
    })
    expect(limits).toEqual({
      title: 'Grok Build',
      planType: 'SuperGrok Heavy',
      windows: [{
        label: 'Weekly limit',
        usedPercent: 0,
        resetsAt: Math.floor(Date.parse(periodEnd) / 1000),
      }],
      extraUsage: null,
      fetchedAt: expect.any(Number),
    })
  })

  it('treats a zero-valued Cent (proto3 omits it) as zero, not missing', () => {
    // proto3 JSON drops zero scalars, so `$0` arrives as `{}`.
    const limits = parseGrokBilling({
      config: { ...REAL_RESPONSE.config, onDemandCap: { val: 500 }, onDemandUsed: {} },
    })
    expect(limits?.extraUsage).toEqual({ usedDollars: 0, limitDollars: 5 })
  })
})
