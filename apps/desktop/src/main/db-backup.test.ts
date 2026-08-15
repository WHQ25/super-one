import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  backupDatabase,
  backupDirFor,
  findRestorableBackup,
  listBackups,
  moveDatabaseAside,
  pruneBackups,
  restoreBackup,
  type BackupCapableDb,
} from './db-backup'

let root: string
let dbPath: string
let backupDir: string

/**
 * Stand-in for a better-sqlite3 handle. Real better-sqlite3 cannot be loaded
 * under vitest (it is built against the Electron ABI), so every DB interaction
 * in `db-backup` goes through this narrow two-method surface.
 */
function fakeDb(options: { userTables?: number } = {}): BackupCapableDb & { pragmas: string[] } {
  const pragmas: string[] = []
  return {
    pragmas,
    pragma: (source: string) => {
      pragmas.push(source)
      return []
    },
    prepare: () => ({ get: () => ({ c: options.userTables ?? 3 }) }),
  }
}

function seedDb(bytes = 1024): void {
  writeFileSync(dbPath, Buffer.alloc(bytes, 7))
  writeFileSync(`${dbPath}-wal`, Buffer.alloc(64, 1))
  writeFileSync(`${dbPath}-shm`, Buffer.alloc(32, 2))
}

function seedBackup(schemaVersion: number, stamp: string, content = 'backup'): string {
  mkdirSync(backupDir, { recursive: true })
  const path = join(backupDir, `superone-schema${schemaVersion}-${stamp}.db`)
  writeFileSync(path, content)
  return path
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'superone-db-backup-'))
  dbPath = join(root, 'superone.db')
  backupDir = backupDirFor(dbPath)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('backup naming and discovery', () => {
  it('places backups in a sibling backups/ directory', () => {
    expect(backupDirFor('/data/SuperOne/superone.db')).toBe('/data/SuperOne/backups')
  })

  it('lists backups newest first and ignores unrelated or partial files', () => {
    seedBackup(1, '20260101-010101')
    seedBackup(3, '20260301-030303')
    seedBackup(2, '20260201-020202')
    writeFileSync(join(backupDir, 'superone-schema9-20260401-040404.db.tmp'), 'partial')
    writeFileSync(join(backupDir, 'notes.txt'), 'unrelated')

    expect(listBackups(backupDir).map((b) => b.stamp)).toEqual([
      '20260301-030303',
      '20260201-020202',
      '20260101-010101',
    ])
    expect(listBackups(backupDir).map((b) => b.schemaVersion)).toEqual([3, 2, 1])
  })

  it('returns an empty list when the backup directory does not exist', () => {
    expect(listBackups(join(root, 'nope'))).toEqual([])
  })
})

describe('creating a pre-migration backup', () => {
  it('checkpoints the WAL then publishes the copy atomically', () => {
    seedDb()
    const db = fakeDb()

    const outcome = backupDatabase({ db, dbPath, backupDir, schemaVersion: 4, now: new Date('2026-08-15T10:20:30Z') })

    expect(outcome.status).toBe('created')
    expect(db.pragmas).toContain('wal_checkpoint(TRUNCATE)')
    const files = readdirSync(backupDir)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^superone-schema4-\d{8}-\d{6}\.db$/)
    // No `.tmp` left behind — the copy is renamed into place only once complete.
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false)
    expect(readFileSync(join(backupDir, files[0]!)).length).toBe(1024)
  })

  it('skips a database that has no user tables (fresh install)', () => {
    seedDb()
    const db = fakeDb({ userTables: 0 })

    const outcome = backupDatabase({ db, dbPath, backupDir, schemaVersion: 1 })

    expect(outcome).toEqual({ status: 'skipped', reason: 'empty-database' })
    expect(existsSync(backupDir)).toBe(false)
  })

  it('skips when the database file is missing', () => {
    const outcome = backupDatabase({ db: fakeDb(), dbPath, backupDir, schemaVersion: 1 })
    expect(outcome).toEqual({ status: 'skipped', reason: 'missing-database' })
  })

  it('skips rather than throwing when free space cannot cover the copy', () => {
    seedDb(4096)

    const outcome = backupDatabase({
      db: fakeDb(),
      dbPath,
      backupDir,
      schemaVersion: 1,
      freeBytesFor: () => 100,
    })

    expect(outcome.status).toBe('skipped')
    expect(outcome).toMatchObject({ reason: 'insufficient-space' })
    expect(listBackups(backupDir)).toEqual([])
  })

  it('does not prune existing snapshots when there is not enough space to copy', () => {
    seedDb(4096)
    seedBackup(1, '20260101-010101')
    seedBackup(2, '20260201-020202')

    const outcome = backupDatabase({
      db: fakeDb(),
      dbPath,
      backupDir,
      schemaVersion: 3,
      freeBytesFor: () => 100,
    })

    expect(outcome).toMatchObject({ status: 'skipped', reason: 'insufficient-space' })
    expect(listBackups(backupDir).map((b) => b.schemaVersion)).toEqual([2, 1])
  })

  it('does not prune existing snapshots when the copy fails', () => {
    mkdirSync(dbPath, { recursive: true })
    seedBackup(1, '20260101-010101')
    seedBackup(2, '20260201-020202')

    expect(() => backupDatabase({ db: fakeDb(), dbPath, backupDir, schemaVersion: 3 })).toThrow()

    expect(listBackups(backupDir).map((b) => b.schemaVersion)).toEqual([2, 1])
  })

  it('prunes old versions only after the new snapshot is durable', () => {
    seedDb()
    seedBackup(1, '20260101-010101')
    seedBackup(2, '20260201-020202')
    seedBackup(3, '20260301-030303')

    backupDatabase({ db: fakeDb(), dbPath, backupDir, schemaVersion: 4, keepVersions: 3 })

    expect(listBackups(backupDir).map((b) => b.schemaVersion)).toEqual([4, 3, 2])
  })
})

describe('retention', () => {
  it('keeps only the newest snapshot per schema version', () => {
    seedBackup(2, '20260201-020202')
    seedBackup(2, '20260202-020202')
    seedBackup(3, '20260301-030303')

    pruneBackups(backupDir, 3)

    expect(listBackups(backupDir).map((b) => b.stamp)).toEqual(['20260301-030303', '20260202-020202'])
  })

  it('keeps the newest N versions and deletes stray partial files', () => {
    seedBackup(1, '20260101-010101')
    seedBackup(2, '20260201-020202')
    seedBackup(3, '20260301-030303')
    seedBackup(4, '20260401-040404')
    writeFileSync(join(backupDir, 'superone-schema9-20260501-050505.db.tmp'), 'partial')

    const removed = pruneBackups(backupDir, 2)

    expect(listBackups(backupDir).map((b) => b.schemaVersion)).toEqual([4, 3])
    expect(removed).toHaveLength(3)
    expect(readdirSync(backupDir).some((f) => f.endsWith('.tmp'))).toBe(false)
  })
})

describe('choosing a backup to restore', () => {
  it('picks the highest schema version the running build can still read', () => {
    seedBackup(1, '20260101-010101')
    seedBackup(3, '20260301-030303')
    seedBackup(7, '20260701-070707')

    expect(findRestorableBackup(backupDir, 5)?.schemaVersion).toBe(3)
    expect(findRestorableBackup(backupDir, 7)?.schemaVersion).toBe(7)
    expect(findRestorableBackup(backupDir, 0)).toBeNull()
  })

  it('prefers the newest snapshot when one version has several', () => {
    seedBackup(2, '20260201-020202')
    const newer = seedBackup(2, '20260202-020202')

    expect(findRestorableBackup(backupDir, 2)?.path).toBe(newer)
  })
})

describe('moving the live database aside', () => {
  it('moves the WAL and SHM sidecars along with the main file', () => {
    seedDb()

    const aside = moveDatabaseAside(dbPath, 'corrupt-20260815-102030')

    expect(existsSync(dbPath)).toBe(false)
    expect(existsSync(`${dbPath}-wal`)).toBe(false)
    expect(existsSync(`${dbPath}-shm`)).toBe(false)
    expect(aside).toBe(join(root, 'superone.corrupt-20260815-102030.db'))
    expect(existsSync(aside)).toBe(true)
    expect(existsSync(`${aside}-wal`)).toBe(true)
    expect(existsSync(`${aside}-shm`)).toBe(true)
  })
})

describe('restoring a backup', () => {
  it('never leaves a stale WAL beside the restored file', () => {
    seedDb()
    const backup = seedBackup(2, '20260201-020202', 'restored-content')

    const result = restoreBackup({ backupPath: backup, dbPath, asideLabel: 'newer-schema9' })

    expect(readFileSync(dbPath, 'utf8')).toBe('restored-content')
    // A restored file paired with the previous database's WAL is self-inflicted
    // corruption — the sidecars must travel with the file they belong to.
    expect(existsSync(`${dbPath}-wal`)).toBe(false)
    expect(existsSync(`${dbPath}-shm`)).toBe(false)
    expect(existsSync(result.movedAsidePath)).toBe(true)
    expect(existsSync(`${result.movedAsidePath}-wal`)).toBe(true)
  })

  it('keeps the displaced database instead of deleting it', () => {
    seedDb()
    writeFileSync(dbPath, 'live-data')
    const backup = seedBackup(2, '20260201-020202')

    const result = restoreBackup({ backupPath: backup, dbPath, asideLabel: 'newer-schema9' })

    expect(readFileSync(result.movedAsidePath, 'utf8')).toBe('live-data')
  })

  it('leaves the backup file itself in place so a failed restore can be retried', () => {
    seedDb()
    const backup = seedBackup(2, '20260201-020202')

    restoreBackup({ backupPath: backup, dbPath, asideLabel: 'newer-schema9' })

    expect(existsSync(backup)).toBe(true)
  })

  it('leaves the live database untouched when the snapshot cannot be copied', () => {
    seedDb()
    writeFileSync(dbPath, 'live-data')
    const missing = join(backupDir, 'missing.db')

    expect(() => restoreBackup({ backupPath: missing, dbPath, asideLabel: 'newer-schema9' })).toThrow()

    expect(readFileSync(dbPath, 'utf8')).toBe('live-data')
    expect(existsSync(`${dbPath}-wal`)).toBe(true)
    expect(existsSync(`${dbPath}.restoring`)).toBe(false)
    expect(readdirSync(root).some((name) => name.includes('newer-schema9'))).toBe(false)
  })
})
