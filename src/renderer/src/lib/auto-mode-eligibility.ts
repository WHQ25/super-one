import type { AccountInfo, ModelOption } from '../../../shared/agent-types'

export type AutoModeReason =
  | 'ok'
  | 'unauthenticated'
  | 'pro_not_supported'
  | 'provider_not_supported'
  | 'admin_disabled'
  | 'model_not_supported'

export type PlanKind = 'max' | 'team' | 'enterprise' | 'api' | 'pro'

export interface AutoModeCtx {
  subscriptionType?: string
  apiProvider?: string
  modelSupportsAutoMode?: boolean
  disableAutoModeSetting?: 'disable'
}

export interface AutoModeEligibility {
  ok: boolean
  reason: AutoModeReason
  message: string
}

export function normalizePlan(input: string | undefined): PlanKind | undefined {
  if (!input) return undefined
  const s = input.toLowerCase().trim()
  if (!s) return undefined
  if (s === 'pro' || /\bpro\b/.test(s)) return 'pro'
  if (s.includes('max')) return 'max'
  if (s.includes('team')) return 'team'
  if (s.includes('enterprise')) return 'enterprise'
  if (s.includes('api')) return 'api'
  return undefined
}

/**
 * The SDK already filters `ModelInfo.supportsAutoMode` by the authenticated
 * account's plan (verified 2026-04-17: Max account sees supportsAutoMode only
 * on Opus 4.7, not Sonnet 4.6). So we do NOT duplicate the plan × model matrix
 * on the client — we trust `modelSupportsAutoMode` as the authoritative signal
 * and only surface higher-level gates (provider, unauthenticated, Pro plan,
 * admin kill switch) to produce differentiated error messages.
 */
export function checkAutoModeEligibility(ctx: AutoModeCtx): AutoModeEligibility {
  if (ctx.apiProvider && ctx.apiProvider !== 'firstParty') {
    return {
      ok: false,
      reason: 'provider_not_supported',
      message: 'Auto Mode requires Anthropic API (not Bedrock/Vertex/Foundry)',
    }
  }

  const plan = normalizePlan(ctx.subscriptionType)
  if (!plan) {
    return { ok: false, reason: 'unauthenticated', message: 'Sign in to a Claude account to use Auto Mode' }
  }
  if (plan === 'pro') {
    return { ok: false, reason: 'pro_not_supported', message: 'Auto Mode is not available on the Pro plan' }
  }

  if (ctx.disableAutoModeSetting === 'disable') {
    return { ok: false, reason: 'admin_disabled', message: 'Auto Mode has been disabled by your administrator' }
  }

  if (ctx.modelSupportsAutoMode !== true) {
    return {
      ok: false,
      reason: 'model_not_supported',
      message: 'This model does not support Auto Mode on your plan',
    }
  }

  return { ok: true, reason: 'ok', message: 'Auto Mode available' }
}

export function eligibilityFromStore(
  account: AccountInfo | null | undefined,
  model: ModelOption | undefined,
  disableAutoModeSetting?: 'disable',
): AutoModeEligibility {
  return checkAutoModeEligibility({
    subscriptionType: account?.subscriptionType,
    apiProvider: account?.apiProvider,
    modelSupportsAutoMode: model?.supportsAutoMode,
    disableAutoModeSetting,
  })
}

/**
 * Plan-layer check only — ignores the specific model. Use for UI surfaces
 * that are not bound to a selected model (e.g. global preferences).
 */
export function checkAutoModePlanEligibility(
  account: AccountInfo | null | undefined,
  disableAutoModeSetting?: 'disable',
): AutoModeEligibility {
  return checkAutoModeEligibility({
    subscriptionType: account?.subscriptionType,
    apiProvider: account?.apiProvider,
    modelSupportsAutoMode: true,
    disableAutoModeSetting,
  })
}
