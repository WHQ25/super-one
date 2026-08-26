/** Host permission gate for page-provided WebMCP tool calls. */

import type { AgentEvent } from '@superone/shared/agent-types'
import { HostConfirmRegistry } from '../session/host-confirm-registry'

const WEBMCP_CALL_QUALIFIED = 'mcp__superone__browser_tools_call'
const CONFIRM_TIMEOUT_MS = 120_000

export type WebmcpCallConfirmOutcome =
  | { action: 'accept'; alwaysAllow: boolean }
  | { action: 'decline' | 'cancel'; reason?: string }

const confirms = new HostConfirmRegistry<WebmcpCallConfirmOutcome>({
  idPrefix: 'webmcpcall',
  timeoutMs: CONFIRM_TIMEOUT_MS,
  timeoutError: () => new Error(
    `WebMCP page-tool confirmation timed out after ${CONFIRM_TIMEOUT_MS}ms`,
  ),
})

export function resolveWebmcpCallConfirm(
  requestId: string,
  action: 'accept' | 'decline' | 'cancel',
  alwaysAllow = false,
  reason?: string,
): boolean {
  const outcome: WebmcpCallConfirmOutcome = action === 'accept'
    ? { action: 'accept', alwaysAllow }
    : { action, reason }
  return confirms.settle(requestId, action === 'accept', outcome)
}

export function rejectWebmcpCallConfirm(requestId: string, reason: string): boolean {
  return confirms.fail(requestId, new Error(reason))
}

export function awaitWebmcpCallConfirm(opts: {
  emitHostEvent: (event: AgentEvent) => void
  origin: string
  toolName: string
  toolInput: Record<string, unknown>
}): Promise<WebmcpCallConfirmOutcome> {
  return confirms.open({ emitHostEvent: opts.emitHostEvent }, (requestId) => ({
    requestId,
    toolName: WEBMCP_CALL_QUALIFIED,
    toolUseId: requestId,
    input: {
      name: opts.toolName,
      input: opts.toolInput,
      origin: opts.origin,
    },
    allowAlwaysAllow: true,
    serverName: 'superone',
    message: `Allow the page at ${opts.origin} to run its tool "${opts.toolName}"?`,
  }))
}
