import type { AccountInfo, ModelOption } from '@superone/shared/agent-types'

/**
 * Historical reasons kept for UI/tests that still branch on them.
 * SuperOne no longer client-gates Auto Mode (Anthropic enables it for Pro/Max/Team
 * as of 2026-08; remote nodes also lack subscription metadata). Claude SDK / account
 * policy is the source of truth if a session rejects `permissionMode: 'auto'`.
 */
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

const ALWAYS_OK: AutoModeEligibility = {
  ok: true,
  reason: 'ok',
  message: 'Auto Mode available',
}

/**
 * Always allows Auto Mode. Plan / provider / model / admin gates were removed
 * so local and remote sessions can select `auto` freely; the Claude runtime
 * decides support.
 */
export function checkAutoModeEligibility(_ctx: AutoModeCtx = {}): AutoModeEligibility {
  return ALWAYS_OK
}

export function eligibilityFromStore(
  _account?: AccountInfo | null,
  _model?: ModelOption,
  _disableAutoModeSetting?: 'disable',
): AutoModeEligibility {
  return ALWAYS_OK
}

/**
 * Plan-layer check only — ignores the specific model. Use for UI surfaces
 * that are not bound to a selected model (e.g. global preferences).
 */
export function checkAutoModePlanEligibility(
  _account?: AccountInfo | null,
  _disableAutoModeSetting?: 'disable',
): AutoModeEligibility {
  return ALWAYS_OK
}
