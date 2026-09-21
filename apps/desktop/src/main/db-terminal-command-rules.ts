import type Database from 'better-sqlite3'
import { getDb } from './database'
import {
  isTerminalCommandAllowed,
  legacyTerminalCommandRuleToRegex,
  validateTerminalCommandRule,
  type TerminalCommandRule,
} from '@superone/shared/terminal-command-rules'

/**
 * "Always allow in this project" rules for `terminal_tabs run` / `attach`
 * (docs/design/terminal-agent-tools.md §5). SuperOne-owned so every harness
 * shares one answer; keyed by the project key (a path locally, `remote:…` for
 * a node) rather than written into any harness's own settings file.
 *
 * `grammar` records which rule language `pattern` is written in. Rules shipped
 * before 0.68 used the `prefix:*` / exact grammar; the schema step below rewrites
 * those as regexes once and stamps them, so the conversion stays idempotent
 * without guessing from the pattern text.
 *
 * The DDL lives here so the migration and the tests build the same table.
 */
const RULE_GRAMMAR = 'regex'
const LEGACY_RULE_GRAMMAR = 'prefix'

export function ensureTerminalCommandRulesSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS terminal_command_rules (
      project_key TEXT NOT NULL,
      pattern TEXT NOT NULL,
      created_at TEXT NOT NULL,
      grammar TEXT NOT NULL DEFAULT '${RULE_GRAMMAR}',
      PRIMARY KEY(project_key, pattern)
    );
  `)
  // Tables created before `grammar` existed hold prefix rules; stamp them as such.
  const cols = db.prepare('PRAGMA table_info(terminal_command_rules)').all() as Array<{ name: string }>
  if (!cols.some((c) => c.name === 'grammar')) {
    db.exec(`ALTER TABLE terminal_command_rules ADD COLUMN grammar TEXT NOT NULL DEFAULT '${LEGACY_RULE_GRAMMAR}'`)
  }
  const legacy = db
    .prepare('SELECT project_key, pattern FROM terminal_command_rules WHERE grammar = ?')
    .all(LEGACY_RULE_GRAMMAR) as Array<{ project_key: string; pattern: string }>
  if (legacy.length === 0) return
  const rewrite = db.prepare(
    'UPDATE OR REPLACE terminal_command_rules SET pattern = ?, grammar = ? WHERE project_key = ? AND pattern = ?',
  )
  for (const row of legacy) {
    rewrite.run(legacyTerminalCommandRuleToRegex(row.pattern), RULE_GRAMMAR, row.project_key, row.pattern)
  }
}

type RuleRow = { project_key: string; pattern: string; created_at: string }

const toRule = (row: RuleRow): TerminalCommandRule => ({ projectKey: row.project_key, pattern: row.pattern, createdAt: row.created_at })

export function listTerminalCommandRules(projectKey: string): TerminalCommandRule[] {
  const rows = getDb()
    .prepare('SELECT project_key, pattern, created_at FROM terminal_command_rules WHERE project_key = ? ORDER BY created_at, pattern')
    .all(projectKey) as RuleRow[]
  return rows.map(toRule)
}

/** Every project's rules, for the settings page that lets the user revoke them. */
export function listAllTerminalCommandRules(): TerminalCommandRule[] {
  const rows = getDb()
    .prepare('SELECT project_key, pattern, created_at FROM terminal_command_rules ORDER BY project_key, created_at, pattern')
    .all() as RuleRow[]
  return rows.map(toRule)
}

/** Stores a regex rule; an invalid regex is refused rather than stored inert. */
export function addTerminalCommandRule(projectKey: string, pattern: string): void {
  const valid = validateTerminalCommandRule(pattern)
  if (!valid.ok) throw new Error(`Invalid terminal command rule: ${valid.reason}`)
  getDb()
    .prepare('INSERT OR IGNORE INTO terminal_command_rules (project_key, pattern, created_at, grammar) VALUES (?, ?, ?, ?)')
    .run(projectKey, pattern, new Date().toISOString(), RULE_GRAMMAR)
}

export function removeTerminalCommandRule(projectKey: string, pattern: string): boolean {
  const result = getDb()
    .prepare('DELETE FROM terminal_command_rules WHERE project_key = ? AND pattern = ?')
    .run(projectKey, pattern)
  return result.changes > 0
}

export function isTerminalCommandPreapproved(projectKey: string, command: string): boolean {
  return isTerminalCommandAllowed(listTerminalCommandRules(projectKey).map((rule) => rule.pattern), command)
}
