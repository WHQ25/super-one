import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { backupDirFor } from './db-backup'
import { openAndPrepareDatabase, type DatabaseBootDeps } from './db-open'
import { SCHEMA_VERSION } from './database-migrations'

vi.mock('./logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

let root: string
let dbPath: string
let backupDir: string

interface DbFixture {
  corrupt?: boolean
  userVersion?: number
  minCompatible?: number
}

/**
 * Keyed by file *content*, not path — restoring a snapshot copies bytes over
 * `superone.db`, and the fake has to follow the bytes the way SQLite would.
 */
const fixtures = new Map<string, DbFixture>()

class FakeDb {
  private readonly fixture: DbFixture
  closed = false

  constructor(readonly path: string) {
    this.fixture = fixtures.get(readFileSync(path, 'utf8')) ?? {}
    if (this.fixture.corrupt) {
      const err = new Error('database disk image is malformed') as Error & { code: string }
      err.code = 'SQLITE_CORRUPT'
      throw err
    }
  }

  pragma(source: string, options?: { simple?: boolean }): unknown {
    if (source === 'user_version') return this.fixture.userVersion ?? 0
    if (source === 'foreign_keys') return 1
    if (source === 'foreign_key_check') return []
    if (source === 'quick_check') return options?.simple ? 'ok' : [{ quick_check: 'ok' }]
    return undefined
  }

  prepare(sql: string) {
    const { minCompatible } = this.fixture
    return {
      get: (...params: unknown[]) => {
        if (sql.includes('sqlite_master')) return { c: 5 }
        if (params[0] === 'min_compatible_schema_version') {
          return minCompatible === undefined ? undefined : { value: String(minCompatible) }
        }
        return undefined
      },
      all: () => [],
      run: () => undefined,
    }
  }

  close(): void {
    this.closed = true
  }
}

function makeDeps(overrides: Partial<DatabaseBootDeps<FakeDb>> = {}): DatabaseBootDeps<FakeDb> {
  return {
    openDatabase: (path: string) => new FakeDb(path),
    migrate: () => ({ fromVersion: 0, toVersion: SCHEMA_VERSION }),
    onIncompatibleDowngrade: () => 'restore',
    onFatal: () => undefined,
    now: () => new Date('2026-08-15T10:20:30Z'),
    ...overrides,
  }
}

function seedDb(userVersion: number, minCompatible?: number, content = 'live-data'): void {
  writeFileSync(dbPath, content)
  writeFileSync(`${dbPath}-wal`, 'wal')
  fixtures.set(content, { userVersion, minCompatible })
}

function corruptDb(): void {
  writeFileSync(dbPath, 'shredded')
  fixtures.set('shredded', { corrupt: true })
}

function seedBackup(schemaVersion: number, stamp: string, options: { corrupt?: boolean } = {}): string {
  const path = join(backupDir, `superone-schema${schemaVersion}-${stamp}.db`)
  const content = `backup-${schemaVersion}-${stamp}`
  writeFileSync(path, content)
  fixtures.set(content, { userVersion: schemaVersion, corrupt: options.corrupt })
  return path
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'superone-db-open-'))
  dbPath = join(root, 'superone.db')
  backupDir = backupDirFor(dbPath)
  mkdirSync(backupDir, { recursive: true })
  fixtures.clear()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('opening a healthy database', () => {
  it('migrates without taking a snapshot when the schema is already current', () => {
    seedDb(SCHEMA_VERSION)
    const migrate = vi.fn(() => ({ fromVersion: SCHEMA_VERSION, toVersion: SCHEMA_VERSION }))

    openAndPrepareDatabase({ dbPath, appVersion: '1.2.3' }, makeDeps({ migrate }))

    expect(migrate).toHaveBeenCalledTimes(1)
    expect(readdirSync(backupDir)).toEqual([])
  })

  it('snapshots the database before a schema change', () => {
    seedDb(SCHEMA_VERSION - 1)

    openAndPrepareDatabase({ dbPath }, makeDeps())

    const backups = readdirSync(backupDir)
    expect(backups).toHaveLength(1)
    // Named for the schema being preserved, not the one being migrated to.
    expect(backups[0]).toMatch(new RegExp(`^superone-schema${SCHEMA_VERSION - 1}-`))
  })

  it('still migrates when the snapshot cannot be written', () => {
    seedDb(SCHEMA_VERSION - 1)
    const migrate = vi.fn(() => ({ fromVersion: SCHEMA_VERSION - 1, toVersion: SCHEMA_VERSION }))
    const backup = vi.fn(() => {
      throw new Error('ENOSPC: no space left on device')
    })

    expect(() => openAndPrepareDatabase({ dbPath }, makeDeps({ migrate, backup }))).not.toThrow()
    expect(migrate).toHaveBeenCalledTimes(1)
  })
})

describe('a database written by a newer build', () => {
  it('keeps running when the newer build still declares backward compatibility', () => {
    seedDb(SCHEMA_VERSION + 5, SCHEMA_VERSION)
    const onIncompatibleDowngrade = vi.fn(() => 'restore' as const)
    const migrate = vi.fn(() => ({ fromVersion: SCHEMA_VERSION + 5, toVersion: SCHEMA_VERSION }))

    openAndPrepareDatabase({ dbPath }, makeDeps({ onIncompatibleDowngrade, migrate }))

    // Additive-only migrations mean the extra columns are simply ignored;
    // restoring a snapshot here would throw away everything the user did in
    // the newer build for no benefit.
    expect(onIncompatibleDowngrade).not.toHaveBeenCalled()
    expect(readFileSync(dbPath, 'utf8')).toBe('live-data')
  })

  it('offers a restore only when the newer build raised the compatibility floor', () => {
    seedDb(SCHEMA_VERSION + 5, SCHEMA_VERSION + 3)
    const snapshot = seedBackup(SCHEMA_VERSION, '20260101-010101')
    const onIncompatibleDowngrade = vi.fn(() => 'restore' as const)

    openAndPrepareDatabase({ dbPath }, makeDeps({ onIncompatibleDowngrade }))

    expect(onIncompatibleDowngrade).toHaveBeenCalledTimes(1)
    expect(readFileSync(dbPath, 'utf8')).toBe(readFileSync(snapshot, 'utf8'))
    // The newer database is preserved, never deleted.
    const kept = readdirSync(root).find((f) => f.includes('newer-schema'))
    expect(kept).toBeDefined()
    expect(readFileSync(join(root, kept!), 'utf8')).toBe('live-data')
  })

  it('stops instead of migrating when the user declines the restore', () => {
    seedDb(SCHEMA_VERSION + 5, SCHEMA_VERSION + 3)
    seedBackup(SCHEMA_VERSION, '20260101-010101')
    const migrate = vi.fn()
    const onFatal = vi.fn()

    expect(() =>
      openAndPrepareDatabase(
        { dbPath },
        makeDeps({ migrate, onFatal, onIncompatibleDowngrade: () => 'quit' }),
      ),
    ).toThrow()

    expect(migrate).not.toHaveBeenCalled()
    expect(readFileSync(dbPath, 'utf8')).toBe('live-data')
  })

  it('stops rather than migrating when no compatible snapshot exists', () => {
    seedDb(SCHEMA_VERSION + 5, SCHEMA_VERSION + 3)
    const migrate = vi.fn()
    const onFatal = vi.fn()

    expect(() => openAndPrepareDatabase({ dbPath }, makeDeps({ migrate, onFatal }))).toThrow()

    expect(onFatal).toHaveBeenCalledTimes(1)
    expect(migrate).not.toHaveBeenCalled()
  })
})

describe('a corrupt database', () => {
  it('restores the newest snapshot that passes an integrity check', () => {
    corruptDb()
    seedBackup(SCHEMA_VERSION, '20260101-010101')
    const newest = seedBackup(SCHEMA_VERSION, '20260202-020202')

    openAndPrepareDatabase({ dbPath }, makeDeps())

    expect(readFileSync(dbPath, 'utf8')).toBe(readFileSync(newest, 'utf8'))
    expect(readdirSync(root).some((f) => f.includes('corrupt-'))).toBe(true)
  })

  it('skips a snapshot that is itself corrupt', () => {
    corruptDb()
    seedBackup(SCHEMA_VERSION - 1, '20260101-010101')
    seedBackup(SCHEMA_VERSION, '20260202-020202', { corrupt: true })

    openAndPrepareDatabase({ dbPath }, makeDeps())

    // Content, not path: a post-restore snapshot of the same schema version
    // prunes the seed file we restored from.
    expect(readFileSync(dbPath, 'utf8')).toBe(`backup-${SCHEMA_VERSION - 1}-20260101-010101`)
  })

  it('never silently starts against an empty database when nothing can be restored', () => {
    corruptDb()
    const onFatal = vi.fn()
    const migrate = vi.fn()

    expect(() => openAndPrepareDatabase({ dbPath }, makeDeps({ onFatal, migrate }))).toThrow()

    expect(onFatal).toHaveBeenCalledTimes(1)
    expect(migrate).not.toHaveBeenCalled()
    // The unreadable file is kept for support, and no fresh file took its place.
    expect(readdirSync(root).some((f) => f.includes('corrupt-'))).toBe(true)
    expect(existsSync(dbPath)).toBe(false)
  })
})

describe('a failing migration', () => {
  it('surfaces the failure instead of leaving the app on a half-migrated schema', () => {
    seedDb(SCHEMA_VERSION - 1)
    const onFatal = vi.fn()
    const migrate = vi.fn(() => {
      throw new Error('no such column: sessions.tags_json')
    })

    expect(() => openAndPrepareDatabase({ dbPath }, makeDeps({ onFatal, migrate }))).toThrow(
      'no such column',
    )

    expect(onFatal).toHaveBeenCalledTimes(1)
    expect(onFatal.mock.calls[0]?.[1]).toContain('no such column')
    // The pre-migration snapshot survives so support can point at it.
    expect(readdirSync(backupDir)).toHaveLength(1)
  })
})
