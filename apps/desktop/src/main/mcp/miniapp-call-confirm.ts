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
import { MINIAPP_CALL_QUALIFIED } from './miniapp-call-policy'

const CONFIRM_TIMEOUT_MS = 120_000

export type MiniappCallConfirmOutcome =
  | { action: 'accept'; alwaysAllow: boolean }
  | { action: 'decline' | 'cancel'; reason?: string }

const pending = new Map<string, {
  resolve: (outcome: MiniappCallConfirmOutcome) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}>()

export function resolveMiniappCallConfirm(
  requestId: string,
  action: 'accept' | 'decline' | 'cancel',
  alwaysAllow = false,
  reason?: string,
): boolean {
  const entry = pending.get(requestId)
  if (!entry) return false
  clearTimeout(entry.timer)
  pending.delete(requestId)
  if (action === 'accept') entry.resolve({ action: 'accept', alwaysAllow })
  else entry.resolve({ action, reason })
  return true
}

export function rejectMiniappCallConfirm(requestId: string, reason: string): boolean {
  const entry = pending.get(requestId)
  if (!entry) return false
  clearTimeout(entry.timer)
  pending.delete(requestId)
  entry.reject(new Error(reason))
  return true
}

export async function awaitMiniappCallConfirm(opts: {
  emitHostEvent: (event: AgentEvent) => void
  appId: string
  tool: string
  toolInput: Record<string, unknown>
  appName?: string
  toolDisplayName?: string
}): Promise<MiniappCallConfirmOutcome> {
  const requestId = `miniappcall_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const label = opts.toolDisplayName ?? opts.tool
  const appLabel = opts.appName ?? opts.appId
  return new Promise<MiniappCallConfirmOutcome>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId)
      reject(new Error(`Mini-app tool confirmation timed out after ${CONFIRM_TIMEOUT_MS}ms`))
    }, CONFIRM_TIMEOUT_MS)
    pending.set(requestId, { resolve, reject, timer })
    opts.emitHostEvent({
      type: 'permission_request',
      request: {
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
      },
    })
  })
}
