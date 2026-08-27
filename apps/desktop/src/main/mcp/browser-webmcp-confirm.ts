/** Host gate for whether a site may expose page tools to the agent at all. */

import type { AgentEvent, WebmcpTrustConfirmPayload } from '@superone/shared/agent-types'
import { HostConfirmRegistry } from '../session/host-confirm-registry'
import type { WebMcpTrustScope } from './webmcp-trust'

const WEBMCP_TRUST_QUALIFIED = 'mcp__superone__browser_tools_list'
const CONFIRM_TIMEOUT_MS = 120_000

export type WebmcpTrustConfirmOutcome =
  | { action: 'accept'; scope: WebMcpTrustScope }
  | { action: 'decline' | 'cancel'; reason?: string }

const confirms = new HostConfirmRegistry<WebmcpTrustConfirmOutcome>({
  idPrefix: 'webmcptrust',
  timeoutMs: CONFIRM_TIMEOUT_MS,
  timeoutError: () => new Error(
    `WebMCP site-trust confirmation timed out after ${CONFIRM_TIMEOUT_MS}ms`,
  ),
})

/**
 * The prompt offers two levels of "yes", but `respondToPermission` only carries a boolean
 * `alwaysAllow`. `formAnswers.scope` is the explicit channel; the boolean is the fallback for
 * callers (remote clients, older prompts) that only know the two-state shape.
 */
function readScope(alwaysAllow: boolean, formAnswers?: Record<string, unknown>): WebMcpTrustScope {
  const raw = formAnswers?.scope
  if (raw === 'session' || raw === 'always') return raw
  return alwaysAllow ? 'always' : 'session'
}

export function resolveWebmcpTrustConfirm(
  requestId: string,
  action: 'accept' | 'decline' | 'cancel',
  alwaysAllow = false,
  reason?: string,
  formAnswers?: Record<string, unknown>,
): boolean {
  const outcome: WebmcpTrustConfirmOutcome = action === 'accept'
    ? { action: 'accept', scope: readScope(alwaysAllow, formAnswers) }
    : { action, reason }
  return confirms.settle(requestId, action === 'accept', outcome)
}

export function rejectWebmcpTrustConfirm(requestId: string, reason: string): boolean {
  return confirms.fail(requestId, new Error(reason))
}

export function awaitWebmcpTrustConfirm(opts: {
  emitHostEvent: (event: AgentEvent) => void
  confirm: WebmcpTrustConfirmPayload
}): Promise<WebmcpTrustConfirmOutcome> {
  const { confirm } = opts
  const message = confirm.reason === 'tool_changed'
    ? `The page at ${confirm.origin} changed the tools you trusted (${confirm.changedTools.join(', ')}). Trust it again?`
    : `Allow ${confirm.origin} to offer its ${confirm.tools.length} page tools to the agent?`
  return confirms.open({ emitHostEvent: opts.emitHostEvent }, (requestId) => ({
    requestId,
    toolName: WEBMCP_TRUST_QUALIFIED,
    toolUseId: requestId,
    input: { origin: confirm.origin, tools: confirm.tools.map(({ name }) => name) },
    requestKind: 'webmcp_trust_confirm',
    webmcpTrustConfirm: confirm,
    allowAlwaysAllow: true,
    serverName: 'superone',
    message,
  }))
}
