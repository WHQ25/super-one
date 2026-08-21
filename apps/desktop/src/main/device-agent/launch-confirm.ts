/**
 * Host permission_request gate for `device_request_launch`.
 *
 * Pattern: session_agents_confirm / miniapp_call — raise a host permission_request
 * from inside the tool executor and block until the user answers via
 * Session.respondToPermission. Resolving there rather than in a backend is what makes
 * this work on ACP and OpenCode too; the backend-layer variant only ever unblocks
 * Claude and Codex.
 *
 * The chosen device travels back on `formAnswers.deviceId`, the same channel
 * session_agents_confirm uses for its form edits — the user may approve a different
 * device than the agent asked for, and the answer has to say which.
 */

import type { AgentEvent, DeviceLaunchConfirmPayload } from '@superone/shared/agent-types'
import { MCP_SUPERONE_TOOL_PREFIX } from '@superone/shared/superone-host-owned-tools'
import { HostConfirmRegistry } from '../session/host-confirm-registry'

const CONFIRM_TIMEOUT_MS = 120_000

export const DEVICE_REQUEST_LAUNCH_QUALIFIED = `${MCP_SUPERONE_TOOL_PREFIX}device_request_launch`

export type DeviceLaunchDecision =
  | { action: 'accept'; deviceId: string }
  | { action: 'decline' | 'cancel'; reason?: string }

const confirms = new HostConfirmRegistry<DeviceLaunchDecision>({
  idPrefix: 'devicelaunch',
  timeoutMs: CONFIRM_TIMEOUT_MS,
  timeoutError: () => new Error(`Device approval timed out after ${CONFIRM_TIMEOUT_MS}ms`),
})

/**
 * Settle from `Session.respondToPermission`.
 *
 * A decline carries no device, and an accept without one falls back to the id the
 * prompt suggested — an older client (mobile, a remote node) that answers plain
 * allow/deny still approves the device the agent asked for rather than failing.
 */
export function resolveDeviceLaunchConfirm(
  requestId: string,
  action: 'accept' | 'decline',
  formAnswers?: Record<string, unknown>,
  reason?: string,
): boolean {
  if (action === 'decline') return confirms.settle(requestId, false, { action: 'decline', reason })
  const answered = formAnswers?.deviceId
  const deviceId = typeof answered === 'string' && answered ? answered : fallbackIds.get(requestId)
  if (!deviceId) return confirms.settle(requestId, false, { action: 'decline', reason: 'No device chosen' })
  return confirms.settle(requestId, true, { action: 'accept', deviceId })
}

export function rejectDeviceLaunchConfirm(requestId: string, reason: string): boolean {
  return confirms.settle(requestId, false, { action: 'cancel', reason })
}

/** requestId -> suggested device, so a plain "allow" still names one. */
const fallbackIds = new Map<string, string>()

export async function awaitDeviceLaunchConfirm(opts: {
  emitHostEvent: (event: AgentEvent) => void
  payload: DeviceLaunchConfirmPayload
  message: string
  signal?: AbortSignal
}): Promise<DeviceLaunchDecision> {
  let openedId: string | null = null
  try {
    return await confirms.open(
      { emitHostEvent: opts.emitHostEvent },
      (requestId) => {
        openedId = requestId
        if (opts.payload.suggestedId) fallbackIds.set(requestId, opts.payload.suggestedId)
        return {
          requestId,
          toolName: DEVICE_REQUEST_LAUNCH_QUALIFIED,
          toolUseId: requestId,
          input: {
            ...(opts.payload.reason ? { reason: opts.payload.reason } : {}),
            device: opts.payload.suggestedId,
          },
          // A device grant is per-session by nature — it ends when the preview is
          // disconnected — so there is nothing durable for "always" to remember.
          allowAlwaysAllow: false,
          requestKind: 'device_launch_confirm',
          serverName: 'superone',
          message: opts.message,
          deviceLaunchConfirm: opts.payload,
        }
      },
      {
        ...(opts.signal ? { signal: opts.signal } : {}),
        abortError: () => new Error('Device approval cancelled'),
      },
    )
  } finally {
    if (openedId) fallbackIds.delete(openedId)
  }
}

/** Test helper — drop parked prompts without settling their waiters. */
export function clearDeviceLaunchConfirmsForTests(): void {
  confirms.clearForTests()
  fallbackIds.clear()
}
