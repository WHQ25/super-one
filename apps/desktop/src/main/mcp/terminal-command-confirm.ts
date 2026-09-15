/**
 * Host permission_request gate for `terminal_tabs run` / `attach` / `close`.
 *
 * Pattern: device_request_control — raise a host permission_request from inside the
 * tool executor and block until the user answers via Session.respondToPermission,
 * which is what makes it work on ACP and OpenCode as well as Claude and Codex.
 *
 * The subject is the *command*, not the terminal (docs/design/terminal-agent-tools.md
 * §5): "always allow" stores a per-project prefix rule for that command, so the user
 * approves `bun run storybook` the way they would in their shell tool, and control of
 * the tab ends when the command does.
 */

import type { AgentEvent } from '@superone/shared/agent-types'
import { MCP_SUPERONE_TOOL_PREFIX } from '@superone/shared/superone-host-owned-tools'
import { HostConfirmRegistry } from '../session/host-confirm-registry'

const CONFIRM_TIMEOUT_MS = 120_000

export const TERMINAL_TABS_QUALIFIED = `${MCP_SUPERONE_TOOL_PREFIX}terminal_tabs`

export type TerminalCommandDecision =
  /** `alwaysAllow` = "and stop asking for this command in this project". */
  | { action: 'accept'; alwaysAllow: boolean }
  | { action: 'decline' | 'cancel'; reason?: string }

const confirms = new HostConfirmRegistry<TerminalCommandDecision>({
  idPrefix: 'terminalcmd',
  timeoutMs: CONFIRM_TIMEOUT_MS,
  timeoutError: () => new Error(`Terminal command approval timed out after ${CONFIRM_TIMEOUT_MS}ms`),
})

/** Settle from `Session.respondToPermission`. */
export function resolveTerminalCommandConfirm(
  requestId: string,
  action: 'accept' | 'decline',
  alwaysAllow = false,
  reason?: string,
): boolean {
  if (action === 'decline') return confirms.settle(requestId, false, { action: 'decline', reason })
  return confirms.settle(requestId, true, { action: 'accept', alwaysAllow })
}

export function rejectTerminalCommandConfirm(requestId: string, reason: string): boolean {
  return confirms.settle(requestId, false, { action: 'cancel', reason })
}

export async function awaitTerminalCommandConfirm(opts: {
  emitHostEvent: (event: AgentEvent) => void
  action: 'run' | 'attach' | 'close'
  command: string
  cwd: string
  /** The rule "always allow" would store; shown so the user knows what they are granting. */
  rule?: string
  tabTitle?: string
  description?: string
  message: string
  /** `close` of a user tab never offers "always". */
  allowAlwaysAllow: boolean
  signal?: AbortSignal
}): Promise<TerminalCommandDecision> {
  return confirms.open(
    { emitHostEvent: opts.emitHostEvent },
    (requestId) => ({
      requestId,
      toolName: TERMINAL_TABS_QUALIFIED,
      toolUseId: requestId,
      input: {
        action: opts.action,
        command: opts.command,
        cwd: opts.cwd,
        ...(opts.tabTitle ? { tab: opts.tabTitle } : {}),
        ...(opts.rule ? { rule: opts.rule } : {}),
        ...(opts.description ? { description: opts.description } : {}),
      },
      allowAlwaysAllow: opts.allowAlwaysAllow,
      supportsAlwaysPersist: opts.allowAlwaysAllow,
      requestKind: 'terminal_command_confirm',
      serverName: 'superone',
      message: opts.message,
    }),
    {
      ...(opts.signal ? { signal: opts.signal } : {}),
      abortError: () => new Error('Terminal command approval cancelled'),
    },
  )
}

/** Test helper — drop parked prompts without settling their waiters. */
export function clearTerminalCommandConfirmsForTests(): void {
  confirms.clearForTests()
}
