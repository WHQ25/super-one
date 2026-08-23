import type { AgentErrorInfo } from './agent-types'

/**
 * Harness-neutral failure classification.
 *
 * Claude gets a typed error code straight off the SDK wire. Every other harness
 * hands us prose — a JSON-RPC `data` string, an SDK error name, a CLI stderr
 * tail — so the only way they reach the same error badge is to recognize the
 * shape of that prose. Matching is deliberately conservative: a wrong label is
 * worse than the honest `unknown` fallback, because the badge tells the user
 * what to do next.
 */

/** Vocabulary shared with the SDK's `SDKAssistantMessageError`, so one UI map serves every harness. */
export type AgentErrorCode =
  | 'authentication_failed'
  | 'oauth_org_not_allowed'
  | 'billing_error'
  | 'rate_limit'
  | 'overloaded'
  | 'invalid_request'
  | 'model_not_found'
  | 'server_error'
  | 'max_output_tokens'

/**
 * HTTP status carried in prose. Requires a keyword anchor — a bare three-digit
 * run matches version strings, byte counts and ids far more often than statuses.
 */
const STATUS_PATTERNS: RegExp[] = [
  /\b(?:status|statuscode|status[_ -]code|http|code)\W{0,3}(\d{3})\b/i,
  /\berror\W{0,3}(\d{3})\b/i,
  /\b(\d{3})\s+(?:unauthorized|forbidden|not found|too many requests|internal server error|bad gateway|service unavailable|gateway timeout|overloaded)\b/i,
]

/** Ordered — the first match wins, so put the narrow phrases above the broad ones. */
const TEXT_PATTERNS: Array<{ pattern: RegExp; code: AgentErrorCode; terminalReason?: string }> = [
  { pattern: /context (?:length|window)|prompt is too long|too many tokens|maximum context/i, code: 'invalid_request', terminalReason: 'prompt_too_long' },
  { pattern: /\brate[ _-]?limit|too many requests|quota exceeded|usage limit/i, code: 'rate_limit' },
  { pattern: /overloaded|capacity|try again (?:in a )?(?:few )?(?:moments|minutes)/i, code: 'overloaded' },
  { pattern: /unauthorized|authentication|invalid api[ _-]?key|expired token|not logged in|please (?:sign|log) in/i, code: 'authentication_failed' },
  { pattern: /\bbilling\b|payment required|insufficient (?:credit|balance|funds)|credit balance/i, code: 'billing_error' },
  { pattern: /model .{0,40}(?:not found|not available|unknown)|unknown model|unsupported model/i, code: 'model_not_found' },
  { pattern: /internal server error|bad gateway|service unavailable|gateway timeout/i, code: 'server_error' },
  { pattern: /max(?:imum)?[ _-]?(?:output[ _-]?)?tokens/i, code: 'max_output_tokens' },
]

/** Status → code, for prose that carries a number but no recognizable phrase. */
function codeFromStatus(status: number): AgentErrorCode | undefined {
  if (status === 401) return 'authentication_failed'
  if (status === 403) return 'oauth_org_not_allowed'
  if (status === 402) return 'billing_error'
  if (status === 404) return 'model_not_found'
  if (status === 429) return 'rate_limit'
  if (status === 529) return 'overloaded'
  if (status >= 500) return 'server_error'
  if (status === 400) return 'invalid_request'
  return undefined
}

export interface AgentErrorClassification {
  code?: AgentErrorCode
  httpStatus?: number
  terminalReason?: string
}

/** Best-effort read of a provider's error prose. Returns an empty object when nothing is recognizable. */
export function classifyAgentErrorText(raw: string): AgentErrorClassification {
  const text = raw.trim()
  if (!text) return {}

  let httpStatus: number | undefined
  for (const pattern of STATUS_PATTERNS) {
    const match = pattern.exec(text)
    if (!match?.[1]) continue
    const parsed = Number(match[1])
    // Only real HTTP failure statuses; 200-range hits are almost always noise.
    if (parsed >= 400 && parsed <= 599) {
      httpStatus = parsed
      break
    }
  }

  for (const { pattern, code, terminalReason } of TEXT_PATTERNS) {
    if (!pattern.test(text)) continue
    return { code, ...(httpStatus === undefined ? {} : { httpStatus }), ...(terminalReason ? { terminalReason } : {}) }
  }

  if (httpStatus !== undefined) {
    const code = codeFromStatus(httpStatus)
    return { httpStatus, ...(code ? { code } : {}) }
  }
  return {}
}

/**
 * Build the event payload a harness attaches to `message_error`. Explicit
 * `overrides` win over anything inferred from the text — a provider that knows
 * its own status code should never be second-guessed by a regex.
 */
export function buildAgentErrorInfo(
  raw: string,
  overrides: Omit<Partial<AgentErrorInfo>, 'raw'> = {},
): AgentErrorInfo {
  const inferred = classifyAgentErrorText(raw)
  const merged: AgentErrorInfo = {
    raw: raw.trim() || 'Unknown error',
    ...inferred,
    ...overrides,
  }
  // Drop keys an override explicitly cleared so the UI's "field absent" checks hold.
  for (const key of Object.keys(merged) as Array<keyof AgentErrorInfo>) {
    if (merged[key] === undefined) delete merged[key]
  }
  return merged
}

/**
 * `terminal_reason` values that mean "quota exhausted" even though the typed
 * code is vaguer. Shared so the UI's error-kind table and the auto-resume
 * scheduler cannot drift apart on what counts as a rate limit.
 */
export const RATE_LIMIT_TERMINAL_REASONS = ['rapid_refill_breaker', 'blocking_limit'] as const

/**
 * Does this failure mean "come back when the quota window resets"?
 *
 * Deliberately narrow: `overloaded` (529) is upstream capacity, not the user's
 * quota, and retrying it on a multi-hour timer would be the wrong advice.
 */
export function isRateLimitErrorInfo(
  info: Pick<AgentErrorInfo, 'code' | 'terminalReason' | 'httpStatus'>,
): boolean {
  if (info.terminalReason && (RATE_LIMIT_TERMINAL_REASONS as readonly string[]).includes(info.terminalReason)) {
    return true
  }
  if (info.code === 'rate_limit') return true
  // Falls through on any other code rather than short-circuiting: the UI's kind
  // table does the same, so a 429 carrying a code that table does not recognise
  // would otherwise render as a rate limit while producing no resume offer —
  // exactly the drift this module exists to prevent.
  return info.httpStatus === 429
}
