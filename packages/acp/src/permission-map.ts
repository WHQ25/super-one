import type { PermissionRequest } from '@superone/shared/agent-types'
import type {
  PermissionOptionKind,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from '@agentclientprotocol/sdk'

export interface PendingPermissionOptions {
  optionId: string
  kind: PermissionOptionKind
}

/** Map ACP requestPermission params → SuperOne PermissionRequest (no Electron). */
export function mapPermissionRequest(params: RequestPermissionRequest): {
  request: PermissionRequest
  options: PendingPermissionOptions[]
} {
  const options = params.options.map((o) => ({
    optionId: o.optionId,
    kind: o.kind,
  }))
  const raw = params.toolCall.rawInput
  const fallbackInput =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}
  const title =
    typeof params.toolCall.title === 'string' && params.toolCall.title.trim()
      ? params.toolCall.title.trim()
      : 'tool'

  return {
    options,
    request: {
      requestId: params.toolCall.toolCallId,
      toolName: title,
      toolUseId: params.toolCall.toolCallId,
      input: fallbackInput,
      allowAlwaysAllow: options.some((o) => o.kind === 'allow_always'),
      decisionReason: title,
      blockedPath: params.toolCall.locations?.[0]?.path,
    },
  }
}

export const ALLOW_ALWAYS_MCP_OPTION_ID = 'allow-always-mcp'

export function mapPermissionDecision(
  options: PendingPermissionOptions[],
  allow: boolean,
  alwaysAllow?: boolean,
  decision?: 'cancel',
): RequestPermissionResponse {
  if (decision === 'cancel') {
    return { outcome: { outcome: 'cancelled' } }
  }
  if (allow && alwaysAllow) {
    const mcpAlways = options.find((o) => o.optionId === ALLOW_ALWAYS_MCP_OPTION_ID)
    if (mcpAlways) {
      return { outcome: { outcome: 'selected', optionId: mcpAlways.optionId } }
    }
  }
  const preferredKind: PermissionOptionKind = allow
    ? alwaysAllow
      ? 'allow_always'
      : 'allow_once'
    : 'reject_once'
  const option =
    options.find((o) => o.kind === preferredKind) ??
    options.find((o) => (allow ? o.kind.startsWith('allow') : o.kind.startsWith('reject')))
  if (!option) {
    return { outcome: { outcome: 'cancelled' } }
  }
  return {
    outcome: {
      outcome: 'selected',
      optionId: option.optionId,
    },
  }
}
