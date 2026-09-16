import type Database from 'better-sqlite3'
import { getDb } from './database'
import { isTerminalCommandAllowed, type TerminalCommandRule } from '@superone/shared/terminal-command-rules'

/**
 * "Always allow in this project" rules for `terminal_tabs run` / `attach`
 * (docs/design/terminal-agent-tools.md §5). SuperOne-owned so every harness
 * shares one answer; keyed by the project key (a path locally, `remote:…` for
 * a node) rather than written into any harness's own settings file.
 *
 * The DDL lives here so the migration and the tests build the same table.
 */
export function ensureTerminalCommandRulesSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS terminal_command_rules (
      project_key TEXT NOT NULL,
      pattern TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(project_key, pattern)
    );
  `)
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

export function addTerminalCommandRule(projectKey: string, pattern: string): void {
  getDb()
    .prepare('INSERT OR IGNORE INTO terminal_command_rules (project_key, pattern, created_at) VALUES (?, ?, ?)')
    .run(projectKey, pattern, new Date().toISOString())
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
