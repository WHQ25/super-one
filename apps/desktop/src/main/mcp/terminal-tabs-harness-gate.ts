import type { HarnessId } from '@superone/shared/session-types'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import { getSessionHost, getTerminalToolDeps } from './superone-mcp-server'
import { TERMINAL_TABS_QUALIFIED } from './terminal-command-confirm'
import {
  authorizeTerminalCommand,
  type TerminalCommandAuthorization,
  type TerminalCommandGateOptions,
} from './terminal-command-gate'
import { resolveTerminalCommandSubject, type TerminalTabsArgs } from './terminal-tools'

/**
 * Entry point for a harness permission layer that asked the host about a
 * `terminal_tabs` call (Claude `canUseTool`, Codex MCP elicitation, ACP
 * `request_permission`, OpenCode `permission.asked`, DeepSeek tool plane).
 *
 * Only `run` / `attach` approve anything; every other action — and a call the
 * executor is going to reject anyway — is let through so the executor can answer
 * with its own specific error instead of a permission prompt for nothing.
 */
export function isTerminalTabsTool(qualifiedName: string): boolean {
  return qualifiedName === TERMINAL_TABS_QUALIFIED
}

export async function gateTerminalTabsCall(
  sessionId: string,
  input: Record<string, unknown>,
  opts: TerminalCommandGateOptions = {},
): Promise<TerminalCommandAuthorization> {
  const terminals = getTerminalToolDeps()
  const session = getSessionHost()?.getSession(sessionId) as
    | { projectPath?: string; cwd?: string; harnessId?: HarnessId; emitHostEvent?: (event: import('@superone/shared/agent-types').AgentEvent) => void }
    | null
    | undefined
  if (!terminals || !session?.projectPath || !session.emitHostEvent || parseRemoteProjectKey(session.projectPath)) {
    return { status: 'allowed' }
  }
  const subject = resolveTerminalCommandSubject(
    terminals,
    { sessionId, cwd: session.cwd || session.projectPath },
    input as TerminalTabsArgs,
  )
  if (!subject) return { status: 'allowed' }
  return authorizeTerminalCommand(
    terminals.rules,
    { sessionId, projectPath: session.projectPath, emitHostEvent: session.emitHostEvent.bind(session) },
    subject,
    opts,
  )
}
