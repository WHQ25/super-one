import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { MIN_COMPATIBLE_SCHEMA_VERSION, SCHEMA_VERSION } from './database-migrations'

/**
 * "Reinstalling the previous version still works" is a property of the
 * *migrations*, not of the backup layer. Backups are the safety net; the
 * guarantee itself comes from migrations being additive-only, because builds
 * that already shipped contain no recovery code at all — they will happily read
 * a newer database as long as nothing they query has been taken away.
 *
 * This test freezes the destructive statements that predate that rule. Anything
 * new that drops or renames must fail here and be reconsidered as a two-release
 * expand/contract change instead.
 */

/**
 * Every file that runs DDL at migration time. `applyMigrations` delegates a
 * table's schema to the module that owns it when tests need the same DDL, and
 * that module is then as much a migration as this file is.
 */
const MIGRATION_SOURCES = [
  join(__dirname, 'database-migrations.ts'),
  join(__dirname, 'db-session-deliveries-schema.ts'),
  join(__dirname, 'db-terminal-command-rules.ts'),
  join(__dirname, '../../../../packages/runtime/src/collaboration/schema.ts'),
]
const DESTRUCTIVE_PATTERN = /\b(?:DROP\s+TABLE(?:\s+IF\s+EXISTS)?|DROP\s+COLUMN|RENAME\s+COLUMN|RENAME\s+TO)\b[^'"`\n]*/gi

/**
 * Statements that already ran on users' machines before this rule existed.
 * Removing an entry is fine (dead migration); **adding** one is the thing this
 * list exists to stop.
 */
const GRANDFATHERED = [
  'DROP TABLE IF EXISTS init_cache',
  'RENAME COLUMN is_official TO is_base',
  'DROP TABLE chat_messages',
  'RENAME TO chat_messages',
  'DROP TABLE sessions',
  'RENAME TO sessions',
  'DROP TABLE global_resource_cache',
  'DROP TABLE IF EXISTS api_providers',
]

/**
 * Rebuilds that only loosen a constraint SQLite cannot alter in place. They keep
 * the table name and every column, so an older build reads and writes the
 * rebuilt table exactly as before — the property this file protects. Adding one
 * needs that shown, and a rebuild that can skip itself rather than fail the
 * migration (architecture.md, "Schema changes").
 */
const CONSTRAINT_ONLY_REBUILDS = [
  // #65: child_session_id UNIQUE → per-relation partial unique indexes.
  'DROP TABLE session_collaboration_grants',
  'RENAME TO session_collaboration_grants',
]

const ALLOWED = [...GRANDFATHERED, ...CONSTRAINT_ONLY_REBUILDS]

function destructiveStatements(): string[] {
  return MIGRATION_SOURCES.flatMap((file) => {
    const source = readFileSync(file, 'utf8')
    return (source.match(DESTRUCTIVE_PATTERN) ?? []).map((match) => match.trim().replace(/\s+/g, ' '))
  })
}

describe('additive-only migration policy', () => {
  it('introduces no destructive statement beyond the grandfathered set', () => {
    const found = destructiveStatements()
    const unexpected = found.filter((statement) => !ALLOWED.includes(statement))

    expect(unexpected, unexpectedMessage(unexpected)).toEqual([])
  })

  it('still contains every allowed statement it claims to (keeps the lists honest)', () => {
    const found = new Set(destructiveStatements())
    const stale = ALLOWED.filter((statement) => !found.has(statement))

    expect(stale, `Remove these from the allowed lists — they are no longer in the migrations: ${stale.join(', ')}`).toEqual([])
  })

  it('keeps the compatibility floor at or below the current schema version', () => {
    expect(MIN_COMPATIBLE_SCHEMA_VERSION).toBeLessThanOrEqual(SCHEMA_VERSION)
  })
})

function unexpectedMessage(unexpected: string[]): string {
  return [
    `New destructive migration statement(s): ${unexpected.join(' | ')}`,
    '',
    'Dropping or renaming breaks users who reinstall an older build — that build queries',
    'the column and gets an error, with no recovery code to fall back on.',
    '',
    'Use expand/contract instead:',
    '  1. This release: add the new column, write both, stop reading the old one.',
    '  2. Two releases later: drop the old column and raise MIN_COMPATIBLE_SCHEMA_VERSION.',
    '',
    'If you are genuinely doing step 2, add the statement to GRANDFATHERED in this file.',
    'A rebuild that keeps the table name and every column and only loosens a constraint',
    'belongs in CONSTRAINT_ONLY_REBUILDS instead.',
  ].join('\n')
}
