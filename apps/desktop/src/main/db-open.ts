import { existsSync } from 'node:fs'

import log from './logger'
import {
  MIN_COMPATIBLE_SCHEMA_VERSION,
  SCHEMA_VERSION,
  type MigrationResult,
} from './database-migrations'
import {
  backupDatabase,
  backupDirFor,
  findRestorableBackup,
  listBackups,
  moveDatabaseAside,
  restoreBackup,
  type BackupCapableDb,
  type BackupOutcome,
} from './db-backup'

/**
 * Startup path for `superone.db`: verify, snapshot, migrate, and — when the
 * file on disk cannot be used as-is — recover rather than quietly starting the
 * app against an empty database.
 *
 * Every boundary is injectable so the whole decision tree can be exercised
 * without better-sqlite3, which cannot load under vitest (Electron ABI).
 */

export interface BootDb extends BackupCapableDb {
  close(): void
}

export type DowngradeChoice = 'restore' | 'quit'

export interface DatabaseBootDeps<TDb extends BootDb> {
  openDatabase: (path: string) => TDb
  migrate: (db: TDb, appVersion?: string) => MigrationResult
  /** Asked only when a newer build declared that it broke backward compatibility. */
  onIncompatibleDowngrade: (context: { dbVersion: number; requiredVersion: number; backupPath: string | null }) => DowngradeChoice
  /** Report an unrecoverable state to the user. The caller then throws. */
  onFatal: (summary: string, detail: string) => void
  now: () => Date
}

export interface DatabaseBootOptions {
  dbPath: string
  backupDir?: string
  appVersion?: string
}

export function openAndPrepareDatabase<TDb extends BootDb>(
  options: DatabaseBootOptions,
  deps: DatabaseBootDeps<TDb> & { backup?: (db: TDb, schemaVersion: number) => BackupOutcome },
): TDb {
  const { dbPath, appVersion } = options
  const backupDir = options.backupDir ?? backupDirFor(dbPath)

  let db = openOrRecover(dbPath, backupDir, deps)
  const dbVersion = readSchemaVersion(db)

  if (dbVersion > SCHEMA_VERSION) {
    db = handleNewerDatabase(db, dbVersion, { dbPath, backupDir }, deps)
  } else if (dbVersion < SCHEMA_VERSION) {
    takeSnapshot(db, dbVersion, backupDir, dbPath, deps)
  }

  try {
    const result = deps.migrate(db, appVersion)
    if (result.fromVersion !== result.toVersion) {
      log.info(`[db] migrated schema ${result.fromVersion} → ${result.toVersion}`)
    }
  } catch (err) {
    // The migration runs in a transaction, so the database is still at its
    // previous schema — intact, just not usable by *this* build. Continuing
    // with code that expects columns which do not exist is how a recoverable
    // situation turns into corrupt writes.
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
    log.error(`[db] migration failed, refusing to start: ${detail}`)
    deps.onFatal(
      'SuperOne could not upgrade its database.',
      `${detail}\n\nYour data is unchanged. A snapshot from before the upgrade is in:\n${backupDir}`,
    )
    throw err
  }

  return db
}

function openOrRecover<TDb extends BootDb>(
  dbPath: string,
  backupDir: string,
  deps: DatabaseBootDeps<TDb>,
): TDb {
  try {
    return openAndProbe(dbPath, deps)
  } catch (err) {
    if (!isCorruptionError(err)) throw err

    const detail = err instanceof Error ? err.message : String(err)
    log.error(`[db] database is unreadable (${detail}); looking for a snapshot to restore`)

    const stamp = fileStamp(deps.now())
    for (const candidate of listBackups(backupDir)) {
      if (candidate.schemaVersion > SCHEMA_VERSION) continue
      if (!passesIntegrityCheck(candidate.path, deps)) {
        log.warn(`[db] snapshot ${candidate.fileName} failed its integrity check; trying an older one`)
        continue
      }
      try {
        const { movedAsidePath } = restoreBackup({ backupPath: candidate.path, dbPath, asideLabel: `corrupt-${stamp}` })
        log.info(`[db] restored ${candidate.fileName}; the unreadable file is kept at ${movedAsidePath}`)
        return openAndProbe(dbPath, deps)
      } catch (restoreErr) {
        log.warn(
          `[db] restore of ${candidate.fileName} failed (${restoreErr instanceof Error ? restoreErr.message : String(restoreErr)}); trying an older one`,
        )
      }
    }

    // Nothing restorable. Keep the damaged file — starting fresh would look
    // like "all my data vanished" and destroy the only copy support could use.
    const kept = existsSync(dbPath) ? moveDatabaseAside(dbPath, `corrupt-${stamp}`) : dbPath
    deps.onFatal(
      'SuperOne could not open its database.',
      `${detail}\n\nNo usable snapshot was found. The unreadable file has been kept at:\n${kept}`,
    )
    throw err
  }
}

/**
 * An older build opening a database written by a newer one.
 *
 * Migrations are additive-only, so the usual answer is "carry on" — the extra
 * columns are simply unused. A restore is offered only when the newer build
 * explicitly raised `min_compatible_schema_version`, because rolling back
 * otherwise would discard whatever the user did in the newer build.
 */
function handleNewerDatabase<TDb extends BootDb>(
  db: TDb,
  dbVersion: number,
  paths: { dbPath: string; backupDir: string },
  deps: DatabaseBootDeps<TDb>,
): TDb {
  const requiredVersion = readMinCompatibleSchemaVersion(db)

  if (requiredVersion <= SCHEMA_VERSION) {
    log.warn(
      `[db] database schema is ${dbVersion}, newer than this build's ${SCHEMA_VERSION}; ` +
        `it declares compatibility down to ${requiredVersion}, continuing`,
    )
    return db
  }

  const candidate = findRestorableBackup(paths.backupDir, SCHEMA_VERSION)
  const choice = deps.onIncompatibleDowngrade({
    dbVersion,
    requiredVersion,
    backupPath: candidate?.path ?? null,
  })

  if (choice === 'quit' || !candidate) {
    const detail =
      `This database was written by a newer version of SuperOne (schema ${dbVersion}) ` +
      `that is not backward compatible with this one (schema ${SCHEMA_VERSION}).` +
      (candidate ? '' : '\n\nNo snapshot old enough to restore was found.')
    log.error(`[db] refusing to open a forward-incompatible database: ${detail}`)
    deps.onFatal('SuperOne cannot open this database.', detail)
    throw new Error(detail)
  }

  db.close()
  try {
    const { movedAsidePath } = restoreBackup({
      backupPath: candidate.path,
      dbPath: paths.dbPath,
      asideLabel: `newer-schema${dbVersion}-${fileStamp(deps.now())}`,
    })
    log.info(`[db] restored ${candidate.fileName}; the newer database is kept at ${movedAsidePath}`)
    return openAndProbe(paths.dbPath, deps)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    log.error(`[db] restore of ${candidate.fileName} failed; the live database is unchanged: ${detail}`)
    deps.onFatal(
      'SuperOne could not restore its database.',
      `${detail}\n\nThe current database was left in place at:\n${paths.dbPath}`,
    )
    throw err
  }
}

function takeSnapshot<TDb extends BootDb>(
  db: TDb,
  dbVersion: number,
  backupDir: string,
  dbPath: string,
  deps: DatabaseBootDeps<TDb> & { backup?: (db: TDb, schemaVersion: number) => BackupOutcome },
): void {
  try {
    const outcome = deps.backup
      ? deps.backup(db, dbVersion)
      : backupDatabase({ db, dbPath, backupDir, schemaVersion: dbVersion, now: deps.now() })

    if (outcome.status === 'created') {
      log.info(
        `[db] snapshot of schema ${dbVersion} written to ${outcome.path} ` +
          `(${Math.round(outcome.sizeBytes / 1048576)}MB in ${outcome.durationMs}ms)`,
      )
    } else if (outcome.reason === 'insufficient-space') {
      log.error(
        `[db] no space for a pre-migration snapshot ` +
          `(need ${outcome.neededBytes} bytes, ${outcome.freeBytes} free); migrating without one`,
      )
    } else {
      log.info(`[db] skipping pre-migration snapshot: ${outcome.reason}`)
    }
  } catch (err) {
    // A snapshot is a safety net, not a precondition. Migrations are
    // additive-only, so refusing to start because the disk is full would be a
    // worse outcome than migrating without a net.
    log.error(`[db] pre-migration snapshot failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function openAndProbe<TDb extends BootDb>(dbPath: string, deps: DatabaseBootDeps<TDb>): TDb {
  const db = deps.openDatabase(dbPath)
  // Cheap smoke test. A full `quick_check` would scan the entire file on every
  // launch (seconds on a multi-hundred-MB database); real damage surfaces as
  // SQLITE_CORRUPT here or on the first read, so the expensive check is saved
  // for the recovery path where it actually decides something.
  db.prepare('SELECT count(*) AS c FROM sqlite_master').get()
  return db
}

function passesIntegrityCheck<TDb extends BootDb>(path: string, deps: DatabaseBootDeps<TDb>): boolean {
  let probe: TDb | null = null
  try {
    probe = deps.openDatabase(path)
    return probe.pragma('quick_check', { simple: true }) === 'ok'
  } catch {
    return false
  } finally {
    try {
      probe?.close()
    } catch {
      // A handle we could not close is not worth failing the recovery over.
    }
  }
}

/** `PRAGMA user_version`, or 0 for databases written before it was stamped. */
function readSchemaVersion(db: BootDb): number {
  const value = db.pragma('user_version', { simple: true })
  return typeof value === 'number' ? value : 0
}

/**
 * The `min_compatible_schema_version` the *writing* build declared. Missing on
 * databases from before this table existed, which correctly reads as 0 — those
 * predate any compatibility break by definition.
 */
function readMinCompatibleSchemaVersion(db: BootDb): number {
  try {
    const row = db
      .prepare('SELECT value FROM app_meta WHERE key = ?')
      .get('min_compatible_schema_version') as { value?: string } | undefined
    const parsed = Number(row?.value)
    return Number.isFinite(parsed) ? parsed : 0
  } catch {
    // `app_meta` does not exist yet on a pre-migration legacy database.
    return 0
  }
}

function isCorruptionError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === 'string' && (code.startsWith('SQLITE_CORRUPT') || code === 'SQLITE_NOTADB')
}

function fileStamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

export { MIN_COMPATIBLE_SCHEMA_VERSION, SCHEMA_VERSION }
