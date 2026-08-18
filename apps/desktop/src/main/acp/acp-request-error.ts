/**
 * User-facing text for JSON-RPC errors returned by an ACP agent.
 *
 * Grok answers a quota-exhausted `session/prompt` with a JSON-RPC error rather
 * than a stop reason (`xai-grok-shell/src/sampling/error.rs` →
 * `map_sampling_err_to_acp`), so the detail we want lives in `error.data`, not
 * in `error.message` (which is the bare literal `"Rate limited"`).
 */

import type { AgentErrorInfo } from '@superone/shared/agent-types'
import { buildAgentErrorInfo } from '@superone/shared/agent-error'

/** Grok's ACP code for HTTP 429, in the JSON-RPC implementation-defined range. */
export const ACP_RATE_LIMITED_ERROR_CODE = -32003

/** Well-known code Grok embeds in the detail when the free quota is spent. */
const FREE_USAGE_EXHAUSTED_CODE = 'subscription:free-usage-exhausted'

const FREE_USAGE_MESSAGE =
  'You’ve reached your free Grok Build usage limit for now. '
  + 'Get SuperGrok for much higher limits, or try again later: '
  + 'https://grok.com/supergrok?referrer=grok-build'

const RATE_LIMITED_MESSAGE =
  'You’ve hit the rate limit for your plan. Upgrade your account or try again later.'

/** `SamplingError::Api`'s Display prefix — users want the body, not the wrapper. */
const API_ERROR_PREFIX = /^API error \(status [^)]*\):\s*/

interface JsonRpcErrorLike {
  code: number
  message: string
  data?: unknown
}

function asJsonRpcError(err: unknown): JsonRpcErrorLike | null {
  if (!err || typeof err !== 'object') return null
  const candidate = err as { code?: unknown; message?: unknown; data?: unknown }
  if (typeof candidate.code !== 'number' || typeof candidate.message !== 'string') return null
  return { code: candidate.code, message: candidate.message, data: candidate.data }
}

/** `data` is a bare string, or `{ message | detail, promptUsage }` once usage is attached. */
function readDetail(data: unknown): string {
  if (typeof data === 'string') return data.trim()
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>
    for (const key of ['message', 'detail', 'details']) {
      const value = record[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  }
  return ''
}

export function isAcpRateLimitError(err: unknown): boolean {
  return asJsonRpcError(err)?.code === ACP_RATE_LIMITED_ERROR_CODE
}

/**
 * One line to show in the chat bubble for a failed ACP turn. Falls back to the
 * plain `Error` message for anything that is not a JSON-RPC failure.
 */
export function describeAcpRequestError(err: unknown): string {
  const rpc = asJsonRpcError(err)
  if (!rpc) return err instanceof Error ? err.message : String(err)
  const detail = readDetail(rpc.data).replace(API_ERROR_PREFIX, '').trim()
  if (rpc.code === ACP_RATE_LIMITED_ERROR_CODE) {
    if (detail.includes(FREE_USAGE_EXHAUSTED_CODE)) return FREE_USAGE_MESSAGE
    return detail || RATE_LIMITED_MESSAGE
  }
  return detail || rpc.message
}

/** Pulls the HTTP status out of `SamplingError::Api`'s Display wrapper before it is stripped. */
const API_ERROR_STATUS = /^API error \(status (\d{3})[^)]*\)/

/**
 * Structured twin of {@link describeAcpRequestError} for the error badge. The
 * user-facing text is unchanged; this recovers the two facts the display string
 * deliberately throws away — the JSON-RPC code and the upstream HTTP status.
 */
export function describeAcpRequestFailure(err: unknown): AgentErrorInfo {
  const raw = describeAcpRequestError(err)
  const rpc = asJsonRpcError(err)
  if (!rpc) return buildAgentErrorInfo(raw)

  const wrapped = readDetail(rpc.data)
  const statusMatch = API_ERROR_STATUS.exec(wrapped)
  const httpStatus = statusMatch?.[1] ? Number(statusMatch[1]) : undefined

  return buildAgentErrorInfo(raw, {
    ...(rpc.code === ACP_RATE_LIMITED_ERROR_CODE ? { code: 'rate_limit' as const } : {}),
    ...(httpStatus === undefined ? {} : { httpStatus }),
  })
}
