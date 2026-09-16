/**
 * Always-allow rules for `terminal_tabs run` / `attach`, scoped per project.
 *
 * Same grammar the harness shell rules use, so the user has one mental model:
 *   `bun run storybook:*`  — prefix: matches `bun run storybook` and `bun run storybook --ci`
 *   `python3`              — exact: matches only `python3`
 * A prefix rule must end at a word boundary: `bun run storybook:*` does not
 * match `bun run storybook-old`.
 */

const PREFIX_SUFFIX = ':*'

export function normalizeTerminalCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ')
}

/** The rule "always allow" stores for a command: the command itself as a prefix. */
export function terminalCommandRuleFor(command: string): string {
  const normalized = normalizeTerminalCommand(command)
  return normalized.endsWith(PREFIX_SUFFIX) ? normalized : `${normalized}${PREFIX_SUFFIX}`
}

export function matchesTerminalCommandRule(pattern: string, command: string): boolean {
  const rule = normalizeTerminalCommand(pattern)
  const cmd = normalizeTerminalCommand(command)
  if (!rule || !cmd) return false
  if (!rule.endsWith(PREFIX_SUFFIX)) return rule === cmd
  const prefix = rule.slice(0, -PREFIX_SUFFIX.length)
  if (!prefix) return false
  return cmd === prefix || cmd.startsWith(`${prefix} `)
}

export function isTerminalCommandAllowed(rules: readonly string[], command: string): boolean {
  return rules.some((rule) => matchesTerminalCommandRule(rule, command))
}

/** One stored rule; `projectKey` is a path locally, `remote:<connection>:<path>` for a node. */
export interface TerminalCommandRule {
  projectKey: string
  pattern: string
  createdAt: string
}
