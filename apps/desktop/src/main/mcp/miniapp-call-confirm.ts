/**
 * Host permission_request gate for non-preapproved miniapp_call.
 *
 * Pattern: session_agents_confirm / config_confirm / video_gen_confirm — raise a host
 * permission_request from inside the tool executor and block until the user
 * answers via Session.respondToPermission. Works on all harnesses because:
 * - outbound: Session.emitHostEvent → forwardEvent (harness-agnostic)
 * - inbound: Session.respondToPermission resolves this map *before* backends
 */

import type { AgentEvent } from '@superone/shared/agent-types'
import { HostConfirmRegistry } from '../session/host-confirm-registry'
import { MINIAPP_CALL_QUALIFIED } from './miniapp-call-policy'

const CONFIRM_TIMEOUT_MS = 120_000

export type MiniappCallConfirmOutcome =
  | { action: 'accept'; alwaysAllow: boolean }
  | { action: 'decline' | 'cancel'; reason?: string }

const confirms = new HostConfirmRegistry<MiniappCallConfirmOutcome>({
  idPrefix: 'miniappcall',
  timeoutMs: CONFIRM_TIMEOUT_MS,
  timeoutError: () => new Error(`Mini-app tool confirmation timed out after ${CONFIRM_TIMEOUT_MS}ms`),
})

export function resolveMiniappCallConfirm(
  requestId: string,
  action: 'accept' | 'decline' | 'cancel',
  alwaysAllow = false,
  reason?: string,
): boolean {
  const outcome: MiniappCallConfirmOutcome =
    action === 'accept' ? { action: 'accept', alwaysAllow } : { action, reason }
  return confirms.settle(requestId, action === 'accept', outcome)
}

export function rejectMiniappCallConfirm(requestId: string, reason: string): boolean {
  return confirms.fail(requestId, new Error(reason))
}

export async function awaitMiniappCallConfirm(opts: {
  emitHostEvent: (event: AgentEvent) => void
  appId: string
  tool: string
  toolInput: Record<string, unknown>
  appName?: string
  toolDisplayName?: string
}): Promise<MiniappCallConfirmOutcome> {
  const label = opts.toolDisplayName ?? opts.tool
  const appLabel = opts.appName ?? opts.appId
  return confirms.open({ emitHostEvent: opts.emitHostEvent }, (requestId) => ({
    requestId,
    toolName: MINIAPP_CALL_QUALIFIED,
    toolUseId: requestId,
    input: {
      appId: opts.appId,
      tool: opts.tool,
      input: opts.toolInput,
    },
    allowAlwaysAllow: true,
    // Distinct from video_gen_confirm so Codex elicitation auto-accept cannot
    // confuse this host event (host events never go through mapApprovalRequest,
    // but the kind documents intent and keeps PermissionPrompt routing clear).
    requestKind: undefined,
    serverName: 'superone',
    message: `Allow mini-app "${appLabel}" to run tool "${label}"?`,
  }))
}
