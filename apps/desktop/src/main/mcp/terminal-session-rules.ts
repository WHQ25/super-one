import { isTerminalCommandAllowed } from '@superone/shared/terminal-command-rules'

/**
 * "Allow for this session" rules for `terminal_tabs run` / `attach`: the same regex
 * grammar as the per-project rules in `db-terminal-command-rules.ts`, but held in
 * memory for one chat session and dropped when it is disposed. Like WebMCP's
 * session trust, this is host-owned so every harness shares one answer.
 */
const sessionRules = new Map<string, Set<string>>()

export function addSessionTerminalCommandRule(sessionId: string, pattern: string): void {
  let rules = sessionRules.get(sessionId)
  if (!rules) {
    rules = new Set()
    sessionRules.set(sessionId, rules)
  }
  rules.add(pattern)
}

export function isTerminalCommandAllowedForSession(sessionId: string, command: string): boolean {
  const rules = sessionRules.get(sessionId)
  return rules ? isTerminalCommandAllowed([...rules], command) : false
}

/** Called from `Session.dispose`; a session that is gone keeps no grants. */
export function forgetSessionTerminalCommandRules(sessionId: string): void {
  sessionRules.delete(sessionId)
}

export function clearSessionTerminalCommandRulesForTests(): void {
  sessionRules.clear()
}
