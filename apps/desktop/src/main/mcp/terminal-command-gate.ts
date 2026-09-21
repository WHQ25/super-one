import type { AgentEvent } from '@superone/shared/agent-types'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness-capabilities'
import type { HarnessId } from '@superone/shared/session-types'
import { resolveTerminalCommandRule, type TerminalCommandRuleScope } from '@superone/shared/terminal-command-rules'
import { awaitTerminalCommandConfirm } from './terminal-command-confirm'

/**
 * The one place a `terminal_tabs run` / `attach` command is authorized
 * (docs/design/terminal-agent-tools.md §5).
 *
 * Which layer calls it depends on the harness
 * (`HARNESS_CAPABILITIES[harness].terminalCommandApproval`):
 *
 * - `harness`: `terminal_tabs` is withheld from the harness's auto-allow projection, so
 *   the harness's own permission layer sees the command first — Claude's auto-mode
 *   classifier, Codex's approval policy / Guardian reviewer, the yolo modes of the
 *   others. Only when the harness asks the host does the backend call this gate, which
 *   answers from the remembered rules or the terminal prompt. The executor then runs
 *   the command without asking again.
 * - `executor`: the harness auto-approves MCP tools with no host hook (Cursor), so the
 *   executor calls the gate itself before typing anything.
 *
 * A remembered grant is a regex rule over the command, kept for this chat session or for
 * the project — never the harness's own name-level "always allow", which would cover
 * every future command.
 */

export interface TerminalRuleStore {
  isPreapproved(projectKey: string, sessionId: string, command: string): boolean
  remember(scope: TerminalCommandRuleScope, projectKey: string, sessionId: string, pattern: string): void
}

export interface TerminalCommandSession {
  sessionId: string
  projectPath: string
  emitHostEvent: (event: AgentEvent) => void
}

export interface TerminalCommandSubject {
  action: 'run' | 'attach'
  command: string
  cwd: string
  tabTitle?: string
  /** The agent's proposed rule (`terminal_tabs.rule`), validated before it is shown. */
  rule?: unknown
  description?: string
}

export type TerminalCommandAuthorization =
  | { status: 'allowed' }
  /** The user said no; `reason` is what they typed, if anything. */
  | { status: 'rejected'; reason: string }
  /** The prompt was withdrawn (interrupt, timeout) before the user answered. */
  | { status: 'cancelled'; reason: string }

export interface TerminalCommandGateOptions {
  signal?: AbortSignal
  /** The harness flagged the call (Claude's classifier): open on Deny, no one-key approve. */
  defaultToNo?: boolean
  /** Why the harness did not clear the call itself, when it said. */
  decisionReason?: string
}

export function terminalCommandApprovalLayer(harnessId: HarnessId | undefined): 'harness' | 'executor' {
  return harnessId ? HARNESS_CAPABILITIES[harnessId].terminalCommandApproval : 'executor'
}

export async function authorizeTerminalCommand(
  rules: TerminalRuleStore,
  session: TerminalCommandSession,
  subject: TerminalCommandSubject,
  opts: TerminalCommandGateOptions = {},
): Promise<TerminalCommandAuthorization> {
  if (rules.isPreapproved(session.projectPath, session.sessionId, subject.command)) return { status: 'allowed' }
  const rule = resolveTerminalCommandRule(subject.rule, subject.command)
  let decision
  try {
    decision = await awaitTerminalCommandConfirm({
      emitHostEvent: session.emitHostEvent,
      action: subject.action,
      command: subject.command,
      cwd: subject.cwd,
      rule,
      tabTitle: subject.tabTitle,
      description: subject.description,
      message: subject.action === 'run'
        ? `Run \`${subject.command}\` in a terminal tab (${subject.cwd})?`
        : `Let the agent interact with \`${subject.command}\` running in tab “${subject.tabTitle ?? ''}”?`,
      allowAlwaysAllow: true,
      defaultToNo: opts.defaultToNo,
      decisionReason: opts.decisionReason,
      signal: opts.signal,
    })
  } catch (error) {
    return { status: 'cancelled', reason: error instanceof Error ? error.message : String(error) }
  }
  if (decision.action !== 'accept') return { status: 'rejected', reason: decision.reason ?? 'User declined' }
  if (decision.remember) rules.remember(decision.remember, session.projectPath, session.sessionId, rule)
  return { status: 'allowed' }
}
