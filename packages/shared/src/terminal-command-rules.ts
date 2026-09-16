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

/**
 * Commands whose first word hands control to something else; the rest of the line is
 * the real command, so a shortened prefix (`sudo rm:*`, `docker exec:*`) would be far
 * wider than what the user just approved.
 */
const SHELL_DELEGATORS = new Set(['sudo', 'doas', 'ssh', 'docker', 'podman', 'kubectl', 'sh', 'bash', 'zsh', 'fish', 'env', 'eval', 'exec', 'nohup', 'xargs', 'time', 'nice', 'watch'])
const SHELL_SYNTAX = /[|&;<>`$()"']/
const PREFIX_WORDS = 2

/**
 * The rule the confirm dialog offers as "always allow": the command shortened to its
 * leading command + subcommand (`bun run dev` → `bun run:*`, `git commit -m x` →
 * `git commit:*`), like Claude Code's Bash suggestions. Falls back to the full command
 * when nothing can be dropped safely: single-word commands, compound shell lines,
 * quoted arguments, and delegators such as `sudo` / `ssh` / `docker`.
 */
export function suggestedTerminalCommandRule(command: string): string {
  const normalized = normalizeTerminalCommand(command)
  const tokens = normalized.split(' ')
  if (SHELL_SYNTAX.test(normalized) || SHELL_DELEGATORS.has(tokens[0] ?? '')) return terminalCommandRuleFor(normalized)
  let leading = tokens.findIndex((token) => token.startsWith('-'))
  if (leading === -1) leading = tokens.length
  const keep = Math.min(PREFIX_WORDS, leading)
  if (keep === 0 || keep === tokens.length) return terminalCommandRuleFor(normalized)
  return `${tokens.slice(0, keep).join(' ')}${PREFIX_SUFFIX}`
}

/**
 * The rule a `terminal_tabs run` confirm offers: the agent's own `rule` when it matches
 * the command it is approving, otherwise the derived suggestion. A non-matching rule is
 * ignored rather than rejected — it only decorates the dialog, and the user reads it
 * before turning it on.
 */
export function resolveTerminalCommandRule(proposed: unknown, command: string): string {
  if (typeof proposed === 'string') {
    const rule = normalizeTerminalCommand(proposed)
    if (matchesTerminalCommandRule(rule, command)) return rule
  }
  return suggestedTerminalCommandRule(command)
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
