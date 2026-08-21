/**
 * Host permission_request gate for `device_request_control`.
 *
 * Pattern: session_agents_confirm / miniapp_call — raise a host permission_request
 * from inside the tool executor and block until the user answers via
 * Session.respondToPermission. Resolving there rather than in a backend is what makes
 * this work on ACP and OpenCode too; the backend-layer variant only ever unblocks
 * Claude and Codex.
 *
 * No bespoke prompt component and no form channel: the agent has already named one
 * device, so the question is a plain yes/no and the standard permission prompt asks it
 * — which also means a "no" arrives with the user's typed feedback attached, and
 * "use a different one" is something they say rather than something they click.
 */

import type { AgentEvent } from '@superone/shared/agent-types'
import { MCP_SUPERONE_TOOL_PREFIX } from '@superone/shared/superone-host-owned-tools'
import { HostConfirmRegistry } from '../session/host-confirm-registry'

const CONFIRM_TIMEOUT_MS = 120_000

export const DEVICE_REQUEST_CONTROL_QUALIFIED = `${MCP_SUPERONE_TOOL_PREFIX}device_request_control`

export type DeviceControlDecision =
  | { action: 'accept' }
  | { action: 'decline' | 'cancel'; reason?: string }

const confirms = new HostConfirmRegistry<DeviceControlDecision>({
  idPrefix: 'devicecontrol',
  timeoutMs: CONFIRM_TIMEOUT_MS,
  timeoutError: () => new Error(`Device approval timed out after ${CONFIRM_TIMEOUT_MS}ms`),
})

/** Settle from `Session.respondToPermission`. */
export function resolveDeviceControlConfirm(
  requestId: string,
  action: 'accept' | 'decline',
  reason?: string,
): boolean {
  if (action === 'decline') return confirms.settle(requestId, false, { action: 'decline', reason })
  return confirms.settle(requestId, true, { action: 'accept' })
}

export function rejectDeviceControlConfirm(requestId: string, reason: string): boolean {
  return confirms.settle(requestId, false, { action: 'cancel', reason })
}

export async function awaitDeviceControlConfirm(opts: {
  emitHostEvent: (event: AgentEvent) => void
  deviceName: string
  /** The runtime, e.g. "iOS 26.4". Same-named simulators exist on every installed one. */
  platform?: string
  reason?: string
  message: string
  signal?: AbortSignal
}): Promise<DeviceControlDecision> {
  return confirms.open(
    { emitHostEvent: opts.emitHostEvent },
    (requestId) => ({
      requestId,
      toolName: DEVICE_REQUEST_CONTROL_QUALIFIED,
      toolUseId: requestId,
      input: {
        device: opts.deviceName,
        // A machine holds the same model on every runtime it has installed — five
        // "iPhone 17 Pro Max" here — so the name alone asks the user to approve
        // blind. The picker this prompt replaced showed the runtime; so does it.
        ...(opts.platform ? { platform: opts.platform } : {}),
        ...(opts.reason ? { description: opts.reason } : {}),
      },
      // A control grant is per-session by nature — it ends when the preview is
      // disconnected — so there is nothing durable for "always" to remember.
      allowAlwaysAllow: false,
      serverName: 'superone',
      message: opts.message,
    }),
    {
      ...(opts.signal ? { signal: opts.signal } : {}),
      abortError: () => new Error('Device approval cancelled'),
    },
  )
}

/** Test helper — drop parked prompts without settling their waiters. */
export function clearDeviceControlConfirmsForTests(): void {
  confirms.clearForTests()
}
