import { buildAgentErrorInfo } from '@superone/shared/agent-error'
import type { AgentErrorInfo } from '@superone/shared/agent-types'

export interface ClaudeResultFailureContext {
  typedCode?: string
  model?: string
  requestId?: string
  retries?: AgentErrorInfo['retries']
  /** A `rate_limit_event` with status `rejected` for this in-flight turn. */
  rejectedRateLimit?: boolean
  /** Unix seconds from the rejected rate-limit event. */
  resetsAt?: number
}

export interface ClaudeResultFailure {
  error: string
  errorInfo: AgentErrorInfo
}

type ClaudeResultLike = Record<string, unknown>

/**
 * Claude can report `subtype: "success"` together with `is_error: true` for a
 * terminal API failure. A rejected rate-limit event is an additional typed
 * provider signal for SDK versions that omit either result flag.
 */
export function isClaudeResultError(
  result: ClaudeResultLike,
  rejectedRateLimit = false,
): boolean {
  return result.is_error === true || result.subtype !== 'success' || rejectedRateLimit
}

function resultErrorText(result: ClaudeResultLike, typedCode?: string): string {
  if (Array.isArray(result.errors)) {
    const errors = result.errors.filter((error): error is string => typeof error === 'string' && error.length > 0)
    if (errors.length > 0) return errors.join('; ')
  }
  if (typeof result.errors === 'string' && result.errors) return result.errors
  if (typeof result.result === 'string' && result.result) return result.result
  return typedCode || 'Unknown error'
}

function decorateMessageErrorText(
  rawError: string,
  typedCode: string | undefined,
  apiStatus: number | undefined,
): string {
  if (typedCode !== 'model_not_found') return rawError
  const suffix = apiStatus ? ` (HTTP ${apiStatus})` : ''
  return `Model not available for this provider${suffix}: ${rawError}`
}

/** Build the one `message_error` payload used by desktop and remote Claude. */
export function buildClaudeResultFailure(
  result: ClaudeResultLike,
  context: ClaudeResultFailureContext = {},
): ClaudeResultFailure {
  const typedCode = context.rejectedRateLimit ? 'rate_limit' : context.typedCode
  const rawError = resultErrorText(result, typedCode)
  const httpStatus = typeof result.api_error_status === 'number' ? result.api_error_status : undefined
  const terminalReason = typeof result.terminal_reason === 'string' ? result.terminal_reason : undefined
  const subtype = typeof result.subtype === 'string' ? result.subtype : undefined
  const errorInfo = buildAgentErrorInfo(rawError, {
    ...(typedCode ? { code: typedCode } : {}),
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(terminalReason ? { terminalReason } : {}),
    ...(subtype ? { subtype } : {}),
    ...(context.model ? { model: context.model } : {}),
    ...(context.requestId ? { requestId: context.requestId } : {}),
    ...(context.retries ? { retries: context.retries } : {}),
    ...(context.resetsAt === undefined ? {} : { resetsAt: context.resetsAt }),
  })
  return {
    error: decorateMessageErrorText(rawError, typedCode, httpStatus),
    errorInfo,
  }
}
