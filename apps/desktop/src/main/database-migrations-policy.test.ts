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

const MIGRATIONS_SOURCE = join(__dirname, 'database-migrations.ts')
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

function destructiveStatements(): string[] {
  const source = readFileSync(MIGRATIONS_SOURCE, 'utf8')
  return (source.match(DESTRUCTIVE_PATTERN) ?? []).map((match) => match.trim().replace(/\s+/g, ' '))
}

describe('additive-only migration policy', () => {
  it('introduces no destructive statement beyond the grandfathered set', () => {
    const found = destructiveStatements()
    const unexpected = found.filter((statement) => !GRANDFATHERED.includes(statement))

    expect(unexpected, unexpectedMessage(unexpected)).toEqual([])
  })

  it('still contains every grandfathered statement it claims to (keeps the list honest)', () => {
    const found = new Set(destructiveStatements())
    const stale = GRANDFATHERED.filter((statement) => !found.has(statement))

    expect(stale, `Remove these from GRANDFATHERED — they are no longer in the migrations: ${stale.join(', ')}`).toEqual([])
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
  ].join('\n')
}
