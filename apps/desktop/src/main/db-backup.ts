import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Pre-migration snapshots of `superone.db`.
 *
 * Deliberately free of `electron` imports: this module is pure filesystem work
 * plus two narrow calls on a database handle, so it can be unit-tested without
 * the Electron ABI build of better-sqlite3 (which cannot load under vitest).
 * All logging and user-facing messaging happens in `db-open.ts`.
 */

/** The slice of a better-sqlite3 handle this module needs. */
export interface BackupCapableDb {
  pragma(source: string, options?: { simple?: boolean }): unknown
  prepare(sql: string): { get(...params: unknown[]): unknown }
}

export interface BackupEntry {
  path: string
  fileName: string
  schemaVersion: number
  /** `YYYYMMDD-HHmmss`, lexicographically sortable. */
  stamp: string
  sizeBytes: number
}

export type BackupOutcome =
  | { status: 'created'; path: string; sizeBytes: number; durationMs: number }
  | { status: 'skipped'; reason: 'missing-database' | 'empty-database' }
  | { status: 'skipped'; reason: 'insufficient-space'; freeBytes: number; neededBytes: number }

export const BACKUP_DIR_NAME = 'backups'
/** How many distinct schema versions keep a snapshot. Each one is a full copy. */
export const KEEP_BACKUP_VERSIONS = 3

const FILE_PREFIX = 'superone-schema'
const FILE_SUFFIX = '.db'
const TMP_SUFFIX = '.tmp'
const NAME_PATTERN = /^superone-schema(\d+)-(\d{8}-\d{6})\.db$/
/**
 * Headroom over the raw file size. The copy is exact, but the destination
 * filesystem may round up to its own block size and we do not want to be the
 * process that fills the last megabyte of a user's disk.
 */
const SPACE_HEADROOM = 1.1

export function backupDirFor(dbPath: string): string {
  return join(dirname(dbPath), BACKUP_DIR_NAME)
}

/** Newest first. Partial (`.tmp`) and unrelated files are ignored. */
export function listBackups(backupDir: string): BackupEntry[] {
  let names: string[]
  try {
    names = readdirSync(backupDir)
  } catch {
    return []
  }

  const entries: BackupEntry[] = []
  for (const fileName of names) {
    const match = NAME_PATTERN.exec(fileName)
    if (!match) continue
    const path = join(backupDir, fileName)
    let sizeBytes = 0
    try {
      sizeBytes = statSync(path).size
    } catch {
      continue
    }
    entries.push({
      path,
      fileName,
      schemaVersion: Number(match[1]),
      stamp: match[2]!,
      sizeBytes,
    })
  }

  return entries.sort((a, b) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0))
}

/**
 * Keep the newest snapshot of each of the `keepVersions` most recent schema
 * versions; delete everything else, including stray `.tmp` files from a copy
 * that was interrupted. Returns the paths removed.
 */
export function pruneBackups(backupDir: string, keepVersions = KEEP_BACKUP_VERSIONS): string[] {
  const removed: string[] = []

  let names: string[] = []
  try {
    names = readdirSync(backupDir)
  } catch {
    return removed
  }

  for (const fileName of names) {
    if (!fileName.endsWith(TMP_SUFFIX)) continue
    const path = join(backupDir, fileName)
    rmSync(path, { force: true })
    removed.push(path)
  }

  const newestPerVersion = new Map<number, BackupEntry>()
  const superseded: BackupEntry[] = []
  // listBackups is newest-first, so the first entry seen for a version wins.
  for (const entry of listBackups(backupDir)) {
    if (newestPerVersion.has(entry.schemaVersion)) {
      superseded.push(entry)
      continue
    }
    newestPerVersion.set(entry.schemaVersion, entry)
  }

  const keptVersions = [...newestPerVersion.keys()].sort((a, b) => b - a).slice(0, Math.max(0, keepVersions))
  const keptSet = new Set(keptVersions)
  const doomed = [...superseded, ...[...newestPerVersion.values()].filter((e) => !keptSet.has(e.schemaVersion))]

  for (const entry of doomed) {
    rmSync(entry.path, { force: true })
    removed.push(entry.path)
  }

  return removed
}

/**
 * The newest snapshot whose schema this build can still read, i.e. the highest
 * version `<= maxSchemaVersion`.
 */
export function findRestorableBackup(backupDir: string, maxSchemaVersion: number): BackupEntry | null {
  const candidates = listBackups(backupDir).filter((entry) => entry.schemaVersion <= maxSchemaVersion)
  if (candidates.length === 0) return null
  // listBackups is newest-first, so the first hit at the highest version wins.
  const bestVersion = Math.max(...candidates.map((entry) => entry.schemaVersion))
  return candidates.find((entry) => entry.schemaVersion === bestVersion) ?? null
}

export interface BackupOptions {
  db: BackupCapableDb
  dbPath: string
  backupDir: string
  /** Schema version of the database *as it stands now* — the state being preserved. */
  schemaVersion: number
  keepVersions?: number
  now?: Date
  /** Injectable for tests; defaults to a `statfs` probe of the backup directory. */
  freeBytesFor?: (dir: string) => number
}

/**
 * Snapshot the database before a migration mutates it.
 *
 * Synchronous on purpose. better-sqlite3 ships an official async `db.backup()`,
 * but `getDb()` is synchronous and called from all over the main process; an
 * async backup would have to run in an earlier bootstrap phase, where a single
 * stray early `getDb()` call would silently skip it and void the safety net.
 * A plain copy right before the migration cannot be ordered wrong.
 *
 * Measured cost: ~430ms for a 890MB database on an NVMe SSD, paid once per
 * schema version bump. (`COPYFILE_FICLONE` makes this free on filesystems that
 * support reflinks — Linux btrfs/XFS. Note that libuv does *not* use
 * `clonefile()` on macOS, so APFS still gets a real copy.)
 */
export function backupDatabase(options: BackupOptions): BackupOutcome {
  const { db, dbPath, backupDir, schemaVersion, keepVersions = KEEP_BACKUP_VERSIONS } = options

  if (!existsSync(dbPath)) return { status: 'skipped', reason: 'missing-database' }
  if (countUserTables(db) === 0) return { status: 'skipped', reason: 'empty-database' }

  // Fold the WAL back into the main file so the copy is self-contained and the
  // backup needs no `-wal` sidecar to be readable.
  db.pragma('wal_checkpoint(TRUNCATE)')

  const sizeBytes = statSync(dbPath).size
  mkdirSync(backupDir, { recursive: true })

  const freeBytes = (options.freeBytesFor ?? freeBytesOf)(backupDir)
  const neededBytes = Math.ceil(sizeBytes * SPACE_HEADROOM)
  if (freeBytes < neededBytes) {
    return { status: 'skipped', reason: 'insufficient-space', freeBytes, neededBytes }
  }

  const fileName = `${FILE_PREFIX}${schemaVersion}-${formatStamp(options.now ?? new Date())}${FILE_SUFFIX}`
  const finalPath = join(backupDir, fileName)
  const tmpPath = `${finalPath}${TMP_SUFFIX}`
  const startedAt = Date.now()

  rmSync(tmpPath, { force: true })
  try {
    copyFileSync(dbPath, tmpPath, constants.COPYFILE_FICLONE)
    // Rename last: a half-written snapshot never carries a name that
    // `listBackups` / `findRestorableBackup` would hand out as restorable.
    renameSync(tmpPath, finalPath)
  } catch (err) {
    rmSync(tmpPath, { force: true })
    throw err
  }

  // Prune only after the new snapshot is durable. Peak disk use can briefly
  // exceed the cap by one file; deleting the last restorable copy first would
  // leave nothing if this copy then fails.
  pruneBackups(backupDir, keepVersions)

  return { status: 'created', path: finalPath, sizeBytes, durationMs: Date.now() - startedAt }
}

/**
 * Rename the live database (and its WAL/SHM sidecars) out of the way, keeping
 * every byte. Returns the new path of the main file.
 */
function moveDatabaseWithSidecars(fromPath: string, toPath: string): void {
  renameSync(fromPath, toPath)
  for (const sidecar of ['-wal', '-shm']) {
    if (existsSync(`${fromPath}${sidecar}`)) {
      renameSync(`${fromPath}${sidecar}`, `${toPath}${sidecar}`)
    }
  }
}

export function moveDatabaseAside(dbPath: string, label: string): string {
  const asidePath = dbPath.replace(/\.db$/, '') + `.${label}.db`
  moveDatabaseWithSidecars(dbPath, asidePath)
  return asidePath
}

export interface RestoreOptions {
  backupPath: string
  dbPath: string
  /** Names the displaced file, e.g. `corrupt-20260815-102030`. */
  asideLabel: string
}

/**
 * Put a snapshot back in place. The database being replaced is moved aside
 * rather than deleted — a recovery that destroys the evidence is how support
 * tickets become unanswerable.
 */
export function restoreBackup(options: RestoreOptions): { movedAsidePath: string } {
  const { backupPath, dbPath, asideLabel } = options
  const restoringPath = `${dbPath}.restoring`

  // Copy first. Moving the live file aside before the snapshot is on disk
  // leaves `dbPath` empty if the copy then throws — and `new Database(dbPath)`
  // would create a blank database on the next open.
  rmSync(restoringPath, { force: true })
  copyFileSync(backupPath, restoringPath, constants.COPYFILE_FICLONE)

  let movedAsidePath: string | undefined
  try {
    movedAsidePath = moveDatabaseAside(dbPath, asideLabel)
    // Sidecars travelled with the live file. A leftover WAL next to the
    // restored main file is self-inflicted corruption.
    for (const sidecar of ['-wal', '-shm']) {
      rmSync(`${dbPath}${sidecar}`, { force: true })
    }
    renameSync(restoringPath, dbPath)
  } catch (err) {
    rmSync(restoringPath, { force: true })
    if (movedAsidePath && existsSync(movedAsidePath) && !existsSync(dbPath)) {
      moveDatabaseWithSidecars(movedAsidePath, dbPath)
    }
    throw err
  }

  if (!movedAsidePath) throw new Error('restore did not displace the live database')
  return { movedAsidePath }
}

function countUserTables(db: BackupCapableDb): number {
  const row = db
    .prepare("SELECT count(*) AS c FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .get() as { c?: number } | undefined
  return row?.c ?? 0
}

function freeBytesOf(dir: string): number {
  try {
    const stats = statfsSync(dir)
    return Number(stats.bavail) * Number(stats.bsize)
  } catch {
    // Unknown free space must not block the snapshot: reporting "plenty" keeps
    // the backup path working on filesystems where statfs is unavailable.
    return Number.MAX_SAFE_INTEGER
  }
}

function formatStamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}
