import { describe, it, expect } from 'vitest'
import {
  checkAutoModeEligibility,
  normalizePlan,
  type AutoModeCtx,
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
  const okCtxMax: AutoModeCtx = {
    subscriptionType: 'Claude Max',
    apiProvider: 'firstParty',
    modelSupportsAutoMode: true,
  }

  it('allows Max plan + firstParty + supportsAutoMode', () => {
    expect(checkAutoModeEligibility(okCtxMax)).toMatchObject({ ok: true, reason: 'ok' })
  })

  it('allows Team / Enterprise / Claude API when supportsAutoMode true', () => {
    expect(
      checkAutoModeEligibility({ ...okCtxMax, subscriptionType: 'team' }),
    ).toMatchObject({ ok: true })
    expect(
      checkAutoModeEligibility({ ...okCtxMax, subscriptionType: 'enterprise' }),
    ).toMatchObject({ ok: true })
    expect(
      checkAutoModeEligibility({ ...okCtxMax, subscriptionType: 'Claude API' }),
    ).toMatchObject({ ok: true })
  })

  it('rejects non-firstParty providers before plan check', () => {
    expect(
      checkAutoModeEligibility({ ...okCtxMax, apiProvider: 'bedrock' }),
    ).toMatchObject({ ok: false, reason: 'provider_not_supported' })
    expect(
      checkAutoModeEligibility({ ...okCtxMax, apiProvider: 'vertex', subscriptionType: 'pro' }),
    ).toMatchObject({ reason: 'provider_not_supported' })
  })

  it('rejects when unauthenticated (no subscriptionType)', () => {
    expect(
      checkAutoModeEligibility({ ...okCtxMax, subscriptionType: undefined }),
    ).toMatchObject({ ok: false, reason: 'unauthenticated' })
  })

  it('rejects Pro plan', () => {
    expect(
      checkAutoModeEligibility({ ...okCtxMax, subscriptionType: 'pro' }),
    ).toMatchObject({ ok: false, reason: 'pro_not_supported' })
  })

  it('rejects when admin has disabled auto mode', () => {
    expect(
      checkAutoModeEligibility({ ...okCtxMax, disableAutoModeSetting: 'disable' }),
    ).toMatchObject({ ok: false, reason: 'admin_disabled' })
  })

  it('rejects when modelSupportsAutoMode is false or undefined', () => {
    expect(
      checkAutoModeEligibility({ ...okCtxMax, modelSupportsAutoMode: false }),
    ).toMatchObject({ ok: false, reason: 'model_not_supported' })
    expect(
      checkAutoModeEligibility({ ...okCtxMax, modelSupportsAutoMode: undefined }),
    ).toMatchObject({ ok: false, reason: 'model_not_supported' })
  })

  it('rejects Max + model without supportsAutoMode (SDK already filtered)', () => {
    // Verified 2026-05-29 against SDK 0.3.154: on a Max account SDK now sets
    // supportsAutoMode on both Opus 4.8 and Sonnet 4.6. The rule we enforce
    // here is the inverse: any model that arrives without supportsAutoMode
    // (e.g. Haiku, or a future model not yet on the Auto Mode allowlist) is
    // rejected via modelSupportsAutoMode regardless of plan.
    expect(
      checkAutoModeEligibility({
        subscriptionType: 'Claude Max',
        apiProvider: 'firstParty',
        modelSupportsAutoMode: undefined,
      }),
    ).toMatchObject({ ok: false, reason: 'model_not_supported' })
  })

  it('short-circuits on provider before checking plan/model', () => {
    const res = checkAutoModeEligibility({
      subscriptionType: 'pro',
      apiProvider: 'bedrock',
      modelSupportsAutoMode: false,
    })
    expect(res.reason).toBe('provider_not_supported')
  })

  it('treats missing apiProvider as firstParty (defensive default)', () => {
    expect(
      checkAutoModeEligibility({ ...okCtxMax, apiProvider: undefined }),
    ).toMatchObject({ ok: true })
  })
})
