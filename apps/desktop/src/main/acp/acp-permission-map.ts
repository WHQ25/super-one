import type { PermissionRequest } from '@superone/shared/agent-types'
import type {
  PermissionOptionKind,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from '@agentclientprotocol/sdk'
import { normalizeAcpTool } from './acp-event-map'

export interface PendingPermissionOptions {
  optionId: string
  kind: PermissionOptionKind
}

export function mapPermissionRequest(params: RequestPermissionRequest): {
  request: PermissionRequest
  options: PendingPermissionOptions[]
} {
  const options = params.options.map((o) => ({
    optionId: o.optionId,
    kind: o.kind,
  }))
  const normalized = normalizeAcpTool(params.toolCall)
  const raw = params.toolCall.rawInput
  const fallbackInput =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {}

  return {
    options,
    request: {
      requestId: params.toolCall.toolCallId,
      toolName: normalized?.toolName
        ?? (typeof params.toolCall.title === 'string' && params.toolCall.title.trim()
          ? params.toolCall.title.trim()
          : 'tool'),
      toolUseId: params.toolCall.toolCallId,
      input: normalized?.input ?? fallbackInput,
      allowAlwaysAllow: options.some((o) => o.kind === 'allow_always'),
      decisionReason: normalized?.toolSummary
        ?? (typeof params.toolCall.title === 'string' ? params.toolCall.title : undefined),
      blockedPath: normalized?.toolFilePath ?? params.toolCall.locations?.[0]?.path,
    },
  }
}

export function mapPermissionDecision(
  options: PendingPermissionOptions[],
  allow: boolean,
  alwaysAllow?: boolean,
  decision?: 'cancel',
): RequestPermissionResponse {
  if (decision === 'cancel') {
    return { outcome: { outcome: 'cancelled' } }
  }
  const preferredKind: PermissionOptionKind = allow
    ? (alwaysAllow ? 'allow_always' : 'allow_once')
    : 'reject_once'
  const option =
    options.find((o) => o.kind === preferredKind)
    ?? options.find((o) => (allow ? o.kind.startsWith('allow') : o.kind.startsWith('reject')))
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
