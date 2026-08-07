import { describe, it, expect } from 'vitest'
import {
  checkAutoModeEligibility,
  checkAutoModePlanEligibility,
  eligibilityFromStore,
  normalizePlan,
} from './auto-mode-eligibility'

describe('normalizePlan', () => {
  it('identifies max variants', () => {
    expect(normalizePlan('max')).toBe('max')
    expect(normalizePlan('Max')).toBe('max')
    expect(normalizePlan('Max 20x')).toBe('max')
    expect(normalizePlan('claude_max')).toBe('max')
    expect(normalizePlan('Claude Max')).toBe('max')
  })

  it('identifies team / enterprise / api / pro', () => {
    expect(normalizePlan('team')).toBe('team')
    expect(normalizePlan('enterprise')).toBe('enterprise')
    expect(normalizePlan('Claude API')).toBe('api')
    expect(normalizePlan('pro')).toBe('pro')
    expect(normalizePlan('Pro')).toBe('pro')
  })

  it('returns undefined for empty or unknown', () => {
    expect(normalizePlan(undefined)).toBeUndefined()
    expect(normalizePlan('')).toBeUndefined()
    expect(normalizePlan('weird_plan')).toBeUndefined()
  })
})

describe('checkAutoModeEligibility', () => {
  it('always allows Auto Mode regardless of plan, provider, or model', () => {
    expect(checkAutoModeEligibility({})).toMatchObject({ ok: true, reason: 'ok' })
    expect(
      checkAutoModeEligibility({
        subscriptionType: 'pro',
        apiProvider: 'bedrock',
        modelSupportsAutoMode: false,
        disableAutoModeSetting: 'disable',
      }),
    ).toMatchObject({ ok: true, reason: 'ok' })
    expect(
      checkAutoModeEligibility({
        subscriptionType: undefined,
        apiProvider: 'vertex',
      }),
    ).toMatchObject({ ok: true })
  })

  it('eligibilityFromStore and plan check always allow', () => {
    expect(eligibilityFromStore(null, undefined)).toMatchObject({ ok: true })
    expect(checkAutoModePlanEligibility(null)).toMatchObject({ ok: true })
    expect(
      eligibilityFromStore(
        { subscriptionType: 'pro', apiProvider: 'firstParty' } as never,
        { id: 'haiku', name: 'Haiku', description: '' },
      ),
    ).toMatchObject({ ok: true })
  })
})
