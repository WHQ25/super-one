import type { AgentErrorInfo } from '@superone/shared/agent-types'

/** i18n leaf under `chat.error.title` / `chat.error.hint`. */
export type AgentErrorKind =
  | 'auth'
  | 'orgNotAllowed'
  | 'billing'
  | 'rateLimit'
  | 'overloaded'
  | 'modelNotFound'
  | 'serverError'
  | 'promptTooLong'
  | 'imageError'
  | 'maxOutputTokens'
  | 'maxTurns'
  | 'budgetExhausted'
  | 'malformedToolUse'
  | 'invalidRequest'
  | 'unknown'

/**
 * `terminal_reason` values that say more than the typed code does — a
 * `prompt_too_long` failure arrives as the vague code `invalid_request`.
 * Deliberately omits `api_error`, which is the generic bucket and must defer
 * to the code, and the non-failure reasons (`completed`, `background_requested`).
 */
const BY_TERMINAL_REASON: Record<string, AgentErrorKind> = {
  prompt_too_long: 'promptTooLong',
  image_error: 'imageError',
  max_turns: 'maxTurns',
  budget_exhausted: 'budgetExhausted',
  malformed_tool_use_exhausted: 'malformedToolUse',
  model_error: 'serverError',
  rapid_refill_breaker: 'rateLimit',
  blocking_limit: 'rateLimit',
}

/** SDK `SDKAssistantMessageError` codes. */
const BY_CODE: Record<string, AgentErrorKind> = {
  authentication_failed: 'auth',
  oauth_org_not_allowed: 'orgNotAllowed',
  billing_error: 'billing',
  rate_limit: 'rateLimit',
  overloaded: 'overloaded',
  invalid_request: 'invalidRequest',
  model_not_found: 'modelNotFound',
  server_error: 'serverError',
  max_output_tokens: 'maxOutputTokens',
}

/** Result `subtype` fallback for turns that end without a typed code. */
const BY_SUBTYPE: Record<string, AgentErrorKind> = {
  error_max_turns: 'maxTurns',
  error_max_budget_usd: 'budgetExhausted',
}

/** HTTP-status fallback for harnesses that report a status but no typed code. */
function kindFromStatus(status: number): AgentErrorKind | undefined {
  if (status === 401 || status === 403) return 'auth'
  if (status === 402) return 'billing'
  if (status === 429) return 'rateLimit'
  if (status === 529) return 'overloaded'
  if (status >= 500) return 'serverError'
  if (status === 400) return 'invalidRequest'
  return undefined
}

/**
 * Pick the plain-language presentation for a failure. Never throws and never
 * returns nothing — an unmapped failure falls through to `unknown`, whose
 * popover leads with the raw upstream text.
 */
export function resolveAgentErrorKind(info: AgentErrorInfo): AgentErrorKind {
  const byReason = info.terminalReason ? BY_TERMINAL_REASON[info.terminalReason] : undefined
  if (byReason) return byReason
  const byCode = info.code ? BY_CODE[info.code] : undefined
  if (byCode) return byCode
  const bySubtype = info.subtype ? BY_SUBTYPE[info.subtype] : undefined
  if (bySubtype) return bySubtype
  if (typeof info.httpStatus === 'number') {
    const byStatus = kindFromStatus(info.httpStatus)
    if (byStatus) return byStatus
  }
  return 'unknown'
}

export interface AgentErrorDetailRow {
  label: string
  value: string
}

/** Developer-facing rows for the collapsed "error details" block. */
export function buildAgentErrorDetails(info: AgentErrorInfo): AgentErrorDetailRow[] {
  const rows: AgentErrorDetailRow[] = []
  if (info.code) rows.push({ label: 'code', value: info.code })
  if (typeof info.httpStatus === 'number') rows.push({ label: 'http', value: String(info.httpStatus) })
  if (info.terminalReason) rows.push({ label: 'terminal_reason', value: info.terminalReason })
  if (info.subtype) rows.push({ label: 'subtype', value: info.subtype })
  if (info.model) rows.push({ label: 'model', value: info.model })
  if (info.requestId) rows.push({ label: 'request_id', value: info.requestId })
  if (info.retries) {
    const { attempts, delaysMs, max } = info.retries
    // Prefer the real backoff ladder; harnesses that only count attempts still
    // get a row rather than being silently dropped.
    const body = delaysMs?.length
      ? delaysMs.map((ms) => `${(ms / 1000).toFixed(1)}s`).join(' → ')
      : `${attempts} ${attempts === 1 ? 'attempt' : 'attempts'}`
    rows.push({ label: 'retries', value: max === undefined ? body : `${body} (max ${max})` })
  }
  return rows
}

/** One blob carrying every field plus the raw text — what the copy button writes. */
export function buildAgentErrorClipboardText(info: AgentErrorInfo): string {
  const rows = buildAgentErrorDetails(info)
  const width = rows.reduce((max, row) => Math.max(max, row.label.length), 0)
  const head = rows.map((row) => `${row.label.padEnd(width)}  ${row.value}`)
  return [...head, ...(head.length > 0 ? [''] : []), info.raw].join('\n')
}
