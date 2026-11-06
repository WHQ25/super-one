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

/** SDK initialization/transport errors can carry the same startup reason as a result. */
export function buildClaudeThrownFailure(error: unknown, context: ClaudeResultFailureContext = {}): ClaudeResultFailure {
  const raw = error instanceof Error ? error.message : String(error)
  const reason = (error as { startupFailureReason?: unknown } | null)?.startupFailureReason
  const upgrade = raw.startsWith('The process answering initialize does not honor onFailure on hook matchers')
  return buildClaudeResultFailure({ errors: [raw], ...(typeof reason === 'string' ? { startup_failure_reason: reason } : {}) },
    { ...context, ...(upgrade ? { typedCode: 'runtime_upgrade_required' } : {}) })
}

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
  const startupFailureReason = typeof result.startup_failure_reason === 'string' ? result.startup_failure_reason : undefined
  const errorInfo = buildAgentErrorInfo(rawError, {
    ...(typedCode ? { code: typedCode } : {}),
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(terminalReason ? { terminalReason } : {}),
    ...(subtype ? { subtype } : {}),
    ...(startupFailureReason ? { startupFailureReason } : {}),
    ...(context.model ? { model: context.model } : {}),
    ...(context.requestId ? { requestId: context.requestId } : {}),
    ...(context.retries ? { retries: context.retries } : {}),
    ...(context.resetsAt === undefined ? {} : { resetsAt: context.resetsAt }),
  })
  return {
    error: startupFailureReason && STARTUP_HINTS[startupFailureReason]
      ? `${STARTUP_HINTS[startupFailureReason]} ${rawError}`
      : decorateMessageErrorText(rawError, typedCode, httpStatus),
    errorInfo,
  }
}

const STARTUP_HINTS: Record<string, string> = {
  sandbox_required_unavailable: 'Claude Code cannot start because the required sandbox is unavailable. Check sandbox support on the host.',
  initialize_not_first: 'Claude Code expected initialize as its first input. Restart the session; if it persists, check the SDK and runtime versions.',
  config_file_invalid: 'Claude Code cannot start because a configuration file contains invalid JSON. Follow the recovery instructions below.',
}
