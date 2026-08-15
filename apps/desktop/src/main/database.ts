import { app, dialog, type App } from 'electron'
import { join } from 'path'
import Database from 'better-sqlite3'
import type { HarnessId, HarnessResourcesMap } from '@superone/shared/agent-types'
import log from './logger'
import { runDatabaseMigrations } from './database-migrations'
import { openAndPrepareDatabase, type DowngradeChoice } from './db-open'

export { runDatabaseMigrations }

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db

  db = openAndPrepareDatabase<Database.Database>(
    {
      dbPath: join(app.getPath('userData'), 'superone.db'),
      appVersion: app.getVersion(),
    },
    {
      openDatabase: openSqlite,
      migrate: (handle, appVersion) => runDatabaseMigrations(handle, { appVersion }),
      onIncompatibleDowngrade: askAboutDowngrade,
      onFatal: reportFatalDatabaseError,
      now: () => new Date(),
    },
  )

  return db
}

function openSqlite(dbPath: string): Database.Database {
  const handle = new Database(dbPath)
  // Performance pragmas
  handle.pragma('journal_mode = WAL')
  handle.pragma('foreign_keys = ON')
  return handle
}

function askAboutDowngrade(context: {
  dbVersion: number
  requiredVersion: number
  backupPath: string | null
}): DowngradeChoice {
  if (!context.backupPath) return 'quit'
  if (!app.isReady()) {
    // No window system yet to host a modal. Restoring is the recoverable
    // choice: the newer database is moved aside, not deleted, so nothing is
    // lost that a later reinstall of the newer build cannot pick back up.
    log.warn('[db] forward-incompatible database found before app ready; restoring the newest snapshot')
    return 'restore'
  }

  const choice = dialog.showMessageBoxSync({
    type: 'warning',
    buttons: ['Restore last backup', 'Quit'],
    defaultId: 0,
    cancelId: 1,
    title: 'Database from a newer version',
    message: 'This database was written by a newer version of SuperOne.',
    detail:
      `It needs schema ${context.requiredVersion} or later, but this version supports ${context.dbVersion > 0 ? 'an older one' : 'none'}.\n\n` +
      `Restoring puts back:\n${context.backupPath}\n\n` +
      'The newer database is kept alongside it, so you can return to the newer version at any time.',
  })
  return choice === 0 ? 'restore' : 'quit'
}

function reportFatalDatabaseError(summary: string, detail: string): void {
  // showErrorBox is the one dialog that works before `app.isReady()`.
  dialog.showErrorBox(summary, detail)
  app.quit()
}


export function getCachedHarnessResources<H extends HarnessId>(
  harnessId: H,
): HarnessResourcesMap[H] | null {
  const row = getDb()
    .prepare('SELECT resources_json FROM harness_resource_cache WHERE harness_id = ?')
    .get(harnessId) as { resources_json: string } | undefined
  if (!row) return null
  try {
    return JSON.parse(row.resources_json) as HarnessResourcesMap[H]
  } catch {
    return null
  }
}

export function getHarnessResourceCacheAgeMs(harnessId: HarnessId): number | null {
  const row = getDb()
    .prepare('SELECT updated_at FROM harness_resource_cache WHERE harness_id = ?')
    .get(harnessId) as { updated_at: string } | undefined
  if (!row) return null
  return Date.now() - new Date(row.updated_at).getTime()
}

export function setCachedHarnessResources<H extends HarnessId>(
  harnessId: H,
  resources: HarnessResourcesMap[H],
): void {
  getDb().prepare(`
    INSERT INTO harness_resource_cache (harness_id, resources_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(harness_id) DO UPDATE SET
      resources_json = excluded.resources_json,
      updated_at = excluded.updated_at
  `).run(harnessId, JSON.stringify(resources), new Date().toISOString())
}

export function maskApiKey(key: string): string {
  if (!key) return ''
  if (key.length <= 6) return '***'
  return '***' + key.slice(-6)
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

export interface PairedDeviceRow {
  id: string
  name: string
  paired_at: string
  last_seen_at: string | null
}

export function upsertPairedDevice(id: string, name: string): void {
  getDb().prepare(`
    INSERT INTO paired_devices (id, name, paired_at, last_seen_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, last_seen_at = excluded.last_seen_at
  `).run(id, name, new Date().toISOString(), new Date().toISOString())
}

export function listPairedDevices(): PairedDeviceRow[] {
  return getDb().prepare('SELECT * FROM paired_devices ORDER BY paired_at DESC').all() as PairedDeviceRow[]
}

export function deletePairedDevice(id: string): void {
  getDb().prepare('DELETE FROM paired_devices WHERE id = ?').run(id)
}

export function isPairedDevice(id: string): boolean {
  return !!getDb().prepare('SELECT 1 FROM paired_devices WHERE id = ?').get(id)
}
