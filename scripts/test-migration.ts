#!/usr/bin/env bun
import Database from 'better-sqlite3'
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { runDatabaseMigrations } from '../src/main/database-migrations.ts'

const DEFAULT_SOURCE = join(
  homedir(),
  'Library',
  'Application Support',
  'super-one',
  'superone.db',
)

type ColumnRow = { name: string; type: string; notnull: number; dflt_value: unknown; pk: number }
type TableMeta = { name: string; columns: ColumnRow[] }

function snapshotSchema(db: Database.Database): Record<string, TableMeta> {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>
  const out: Record<string, TableMeta> = {}
  for (const { name } of tables) {
    const columns = db.prepare(`PRAGMA table_info(${name})`).all() as ColumnRow[]
    out[name] = { name, columns }
  }
  return out
}

function tableCounts(db: Database.Database, tables: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const t of tables) {
    try {
      const row = db.prepare(`SELECT count(*) AS c FROM ${t}`).get() as { c: number }
      out[t] = row.c
    } catch {
      out[t] = -1
    }
  }
  return out
}

function diffSchema(before: Record<string, TableMeta>, after: Record<string, TableMeta>): string[] {
  const diffs: string[] = []
  const allTables = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const t of allTables) {
    if (!before[t]) {
      diffs.push(`+ table ${t}`)
      continue
    }
    if (!after[t]) {
      diffs.push(`- table ${t}`)
      continue
    }
    const beforeCols = new Map(before[t].columns.map((c) => [c.name, c]))
    const afterCols = new Map(after[t].columns.map((c) => [c.name, c]))
    for (const [col] of afterCols) {
      if (!beforeCols.has(col)) diffs.push(`  ${t}: + column ${col}`)
    }
    for (const [col] of beforeCols) {
      if (!afterCols.has(col)) diffs.push(`  ${t}: - column ${col}`)
    }
  }
  return diffs
}

type Check = { name: string; pass: boolean; detail?: string }

function assertInvariants(db: Database.Database): Check[] {
  const checks: Check[] = []

  const sessionCols = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
  const sessionColNames = new Set(sessionCols.map((c) => c.name))
  checks.push({
    name: 'sessions has provider_session_id',
    pass: sessionColNames.has('provider_session_id'),
  })
  checks.push({
    name: 'sessions dropped claude_session_id',
    pass: !sessionColNames.has('claude_session_id'),
  })

  const msgCols = db.prepare('PRAGMA table_info(chat_messages)').all() as Array<{ name: string }>
  const msgColNames = new Set(msgCols.map((c) => c.name))
  checks.push({
    name: 'chat_messages dropped claude_session_id',
    pass: !msgColNames.has('claude_session_id'),
  })
  checks.push({
    name: 'chat_messages has session_id FK',
    pass: msgColNames.has('session_id'),
  })

  const hasSessionProviders = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_providers'")
    .get()
  checks.push({
    name: 'session_providers table exists',
    pass: !!hasSessionProviders,
  })

  if (hasSessionProviders) {
    const seeded = db
      .prepare("SELECT id FROM session_providers WHERE id IN ('claude-base', 'codex-base')")
      .all() as Array<{ id: string }>
    const seededIds = new Set(seeded.map((r) => r.id))
    checks.push({
      name: 'session_providers seeded (claude-base, codex-base)',
      pass: seededIds.has('claude-base') && seededIds.has('codex-base'),
      detail: `found: ${[...seededIds].join(', ') || 'none'}`,
    })
  }

  const orphanClaudeSessions = db
    .prepare(
      "SELECT count(*) AS c FROM sessions WHERE (provider = 'claude' OR provider IS NULL) AND provider_session_id IS NULL",
    )
    .get() as { c: number }
  checks.push({
    name: 'claude sessions have provider_session_id backfilled',
    pass: orphanClaudeSessions.c === 0,
    detail: `${orphanClaudeSessions.c} sessions missing provider_session_id`,
  })

  const orphanMessages = db
    .prepare(
      "SELECT count(*) AS c FROM chat_messages WHERE session_id NOT IN (SELECT id FROM sessions)",
    )
    .get() as { c: number }
  checks.push({
    name: 'chat_messages.session_id all reference valid sessions',
    pass: orphanMessages.c === 0,
    detail: `${orphanMessages.c} orphan messages`,
  })

  const idx = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='sessions'")
    .all() as Array<{ name: string }>
  const idxNames = new Set(idx.map((r) => r.name))
  checks.push({
    name: 'idx_sessions_provider_session_id index present',
    pass: idxNames.has('idx_sessions_provider_session_id'),
  })

  return checks
}

function fmt(row: Record<string, number>): string {
  return Object.entries(row)
    .map(([k, v]) => `  ${k.padEnd(28)} ${v}`)
    .join('\n')
}

function main(): void {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      source: { type: 'string', short: 's' },
      keep: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: false,
  })

  if (values.help) {
    console.log(`Usage: bun run scripts/test-migration.ts [--source <path>] [--keep]

  --source <path>   Source DB to copy (default: production DB)
  --keep            Do not delete the temp snapshot after the run
`)
    process.exit(0)
  }

  const source = values.source ?? DEFAULT_SOURCE
  if (!existsSync(source)) {
    console.error(`[x] source DB not found: ${source}`)
    process.exit(2)
  }

  const workDir = mkdtempSync(join(tmpdir(), 'superone-migration-'))
  const snapshot = join(workDir, 'superone.db')
  cpSync(source, snapshot)
  console.log(`[i] source:   ${source}`)
  console.log(`[i] snapshot: ${snapshot}\n`)

  const before = new Database(snapshot, { readonly: true })
  const beforeSchema = snapshotSchema(before)
  const trackedTables = [
    'projects',
    'sessions',
    'chat_messages',
    'session_providers',
    'api_providers',
  ]
  const beforeCounts = tableCounts(before, trackedTables)
  before.close()

  console.log('[i] before counts:')
  console.log(fmt(beforeCounts))
  console.log('')

  const db = new Database(snapshot)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  const t0 = Date.now()
  runDatabaseMigrations(db)
  const dur = Date.now() - t0
  console.log(`[i] migration completed in ${dur}ms\n`)

  const afterSchema = snapshotSchema(db)
  const afterCounts = tableCounts(db, trackedTables)
  const checks = assertInvariants(db)
  db.close()

  console.log('[i] after counts:')
  console.log(fmt(afterCounts))
  console.log('')

  const diffs = diffSchema(beforeSchema, afterSchema)
  if (diffs.length > 0) {
    console.log('[i] schema diff:')
    for (const d of diffs) console.log(d)
    console.log('')
  } else {
    console.log('[i] schema diff: (none)\n')
  }

  console.log('[i] invariant checks:')
  let failed = 0
  for (const c of checks) {
    const mark = c.pass ? '✓' : '✗'
    const detail = c.detail ? ` — ${c.detail}` : ''
    console.log(`  ${mark} ${c.name}${detail}`)
    if (!c.pass) failed++
  }
  console.log('')

  if (!values.keep) {
    rmSync(workDir, { recursive: true, force: true })
  } else {
    console.log(`[i] snapshot kept at: ${snapshot}`)
  }

  if (failed > 0) {
    console.error(`[x] ${failed} invariant check(s) failed`)
    process.exit(1)
  }
  console.log('[✓] all invariants passed')
}

main()
