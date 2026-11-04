import type { PermissionRequest } from '@superone/shared/agent-types'
import type {
  PermissionOptionKind,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from '@agentclientprotocol/sdk'
import {
  extractAntigravitySecurityWarning,
  normalizeAntigravityRawInput,
} from './antigravity-protocol'
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
  const normalizedRaw = normalizeAntigravityRawInput(
    params.toolCall.rawInput,
    params.toolCall.rawOutput,
    typeof params.toolCall.title === 'string' ? params.toolCall.title : undefined,
    (params.toolCall as { _meta?: unknown })._meta,
    params.toolCall.kind,
  )
  const toolCallForNormalize = {
    ...params.toolCall,
    ...(normalizedRaw.inferredKind && !params.toolCall.kind
      ? { kind: normalizedRaw.inferredKind }
      : {}),
    ...(normalizedRaw.normalizedTitle !== undefined
      ? { title: normalizedRaw.normalizedTitle }
      : {}),
    ...(normalizedRaw.normalizedMeta !== undefined
      ? { _meta: normalizedRaw.normalizedMeta }
      : {}),
    rawInput: normalizedRaw.rawInput,
  }
  const normalized = normalizeAcpTool(toolCallForNormalize)
  const fallbackInput = normalizedRaw.rawInput
  const warning = extractAntigravitySecurityWarning(params.options)
  const baseReason =
    normalized?.toolSummary ??
    (typeof params.toolCall.title === 'string' ? params.toolCall.title : undefined)
  const decisionReason =
    warning && baseReason
      ? `${baseReason} — ${warning}`
      : warning ?? baseReason

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
      decisionReason,
      blockedPath: normalized?.toolFilePath ?? params.toolCall.locations?.[0]?.path,
    },
  }
}

/** Grok Desktop/TUI MCP option id — carries server/tool scope meta on the agent. */
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
    // Prefer Grok's MCP-scoped always option so the agent grants tool/server
    // session allow-lists instead of only a one-shot allow.
    const mcpAlways = options.find((o) => o.optionId === ALLOW_ALWAYS_MCP_OPTION_ID)
    if (mcpAlways) {
      return { outcome: { outcome: 'selected', optionId: mcpAlways.optionId } }
    }
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
