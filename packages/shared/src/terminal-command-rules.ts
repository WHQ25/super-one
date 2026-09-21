import { Script } from 'node:vm'

/**
 * Allow rules for `terminal_tabs run` / `attach`, scoped per project or per chat session.
 *
 * A rule is a JavaScript regular expression matched against the *whole* normalized
 * command (implicitly anchored `^(?:rule)$`), so a rule can only widen what it spells out:
 *   `bun run dev( .*)?`                 — `bun run dev` with or without extra arguments
 *   `(\w+=\S+ )*bun run dev( .*)?`      — the same, with leading env assignments
 *   `python3`                           — exactly `python3`
 * Commands are whitespace-normalized before matching, so a rule never has to account
 * for double spaces.
 */

const MAX_RULE_LENGTH = 512

export function normalizeTerminalCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ')
}

export function escapeTerminalCommandRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Regex tail accepting optional further arguments after a literal prefix. */
const ARGS_TAIL = '( .*)?'
/** Regex head accepting `NAME=value` assignments before the command word. */
const ENV_HEAD = '(\\w+=\\S+ )*'
const ENV_ASSIGNMENT = /^\w+=\S+$/

/** The rule that allows exactly this command plus any further arguments. */
export function terminalCommandRuleFor(command: string): string {
  return `${escapeTerminalCommandRegex(normalizeTerminalCommand(command))}${ARGS_TAIL}`
}

/**
 * Commands whose first word hands control to something else; the rest of the line is
 * the real command, so a shortened prefix (`sudo rm`, `docker exec`) would be far
 * wider than what the user just approved.
 */
const SHELL_DELEGATORS = new Set(['sudo', 'doas', 'ssh', 'docker', 'podman', 'kubectl', 'sh', 'bash', 'zsh', 'fish', 'env', 'eval', 'exec', 'nohup', 'xargs', 'time', 'nice', 'watch'])
const SHELL_SYNTAX = /[|&;<>`$()"']/
const PREFIX_WORDS = 2

/**
 * The rule the confirm dialog offers when the agent proposes none: the command shortened
 * to its leading command + subcommand (`bun run dev` → `bun run( .*)?`, `git commit -m x`
 * → `git commit( .*)?`), like Claude Code's Bash suggestions. Leading `NAME=value`
 * assignments are generalized to `(\w+=\S+ )*` so the port or flag in them does not pin
 * the rule. Falls back to the full command when nothing can be dropped safely:
 * single-word commands, compound shell lines, quoted arguments, and delegators such as
 * `sudo` / `ssh` / `docker`.
 */
export function suggestedTerminalCommandRule(command: string): string {
  const normalized = normalizeTerminalCommand(command)
  if (SHELL_SYNTAX.test(normalized)) return terminalCommandRuleFor(normalized)
  const tokens = normalized.split(' ')
  let envCount = 0
  while (envCount < tokens.length && ENV_ASSIGNMENT.test(tokens[envCount]!)) envCount++
  const words = tokens.slice(envCount)
  const head = envCount > 0 ? ENV_HEAD : ''
  if (words.length === 0 || SHELL_DELEGATORS.has(words[0]!)) return terminalCommandRuleFor(normalized)
  let leading = words.findIndex((token) => token.startsWith('-'))
  if (leading === -1) leading = words.length
  const keep = Math.min(PREFIX_WORDS, leading)
  if (keep === 0) return terminalCommandRuleFor(normalized)
  return `${head}${escapeTerminalCommandRegex(words.slice(0, keep).join(' '))}${ARGS_TAIL}`
}

export type TerminalCommandRuleValidation = { ok: true } | { ok: false; reason: string }

/** Syntax check for a rule before it is stored or offered. */
export function validateTerminalCommandRule(pattern: string): TerminalCommandRuleValidation {
  const rule = normalizeTerminalCommand(pattern)
  if (!rule) return { ok: false, reason: 'Rule is empty.' }
  if (rule.length > MAX_RULE_LENGTH) return { ok: false, reason: `Rule is longer than ${MAX_RULE_LENGTH} characters.` }
  return compileTerminalCommandRule(rule) ? { ok: true } : { ok: false, reason: 'Rule is not a valid regular expression.' }
}

const compiled = new Map<string, RegExp | null>()
const COMPILED_CACHE_LIMIT = 256
// Host-only matching: keep arbitrary JS regexes interruptible, including stored
// rules. Never interpolate a rule or command into executable source.
const matchScript = new Script('rule.test(command)')
const MATCH_TIMEOUT_MS = 20

function compileTerminalCommandRule(rule: string): RegExp | null {
  const cached = compiled.get(rule)
  if (cached !== undefined) return cached
  let regex: RegExp | null
  try {
    regex = new RegExp(`^(?:${rule})$`)
  } catch {
    regex = null
  }
  if (compiled.size >= COMPILED_CACHE_LIMIT) compiled.clear()
  compiled.set(rule, regex)
  return regex
}

/**
 * The rule a `terminal_tabs run` confirm offers: the agent's own `rule` when it is valid
 * and matches the command it is approving, otherwise the derived suggestion. A
 * non-matching rule is ignored rather than rejected — it only decorates the dialog, and
 * the user reads it before turning it on.
 */
export function resolveTerminalCommandRule(proposed: unknown, command: string): string {
  if (typeof proposed === 'string') {
    const rule = normalizeTerminalCommand(proposed)
    if (validateTerminalCommandRule(rule).ok && matchesTerminalCommandRule(rule, command)) return rule
  }
  return suggestedTerminalCommandRule(command)
}

export function matchesTerminalCommandRule(pattern: string, command: string): boolean {
  const rule = normalizeTerminalCommand(pattern)
  const cmd = normalizeTerminalCommand(command)
  if (!rule || !cmd || rule.length > MAX_RULE_LENGTH) return false
  const regex = compileTerminalCommandRule(rule)
  if (!regex) return false
  try {
    return matchScript.runInNewContext({ rule: regex, command: cmd }, { timeout: MATCH_TIMEOUT_MS }) === true
  } catch {
    // Fail closed and avoid repeatedly spending the timeout on this rule.
    compiled.set(rule, null)
    return false
  }
}

export function isTerminalCommandAllowed(rules: readonly string[], command: string): boolean {
  return rules.some((rule) => matchesTerminalCommandRule(rule, command))
}

/**
 * Convert a rule written in the pre-regex grammar (`prefix:*` or an exact command) to the
 * regex grammar. Used once by the database migration; new rules are regexes from the start.
 */
export function legacyTerminalCommandRuleToRegex(pattern: string): string {
  const rule = normalizeTerminalCommand(pattern)
  if (rule.endsWith(':*')) return terminalCommandRuleFor(rule.slice(0, -2))
  return escapeTerminalCommandRegex(rule)
}

/** How long a grant lasts. */
export type TerminalCommandRuleScope = 'session' | 'project'

/** One stored rule; `projectKey` is a path locally, `remote:<connection>:<path>` for a node. */
export interface TerminalCommandRule {
  projectKey: string
  pattern: string
  createdAt: string
}
