import { homedir } from 'node:os'
import { join, sep } from 'node:path'
import { app, session } from 'electron'
import {
  isStorageApplyAction,
  type StorageActionResult,
  type StorageInventory,
  type StorageWorktree,
  type StorageWorktreeRemoval,
} from '@superone/shared/desktop-storage'
import { worktreeGit } from '@superone/runtime/git'
import { getDb } from './database'
import { listSessionDeliveries } from './db-session-deliveries'
import { previewSyncZoneReclaim, sweepSyncZone, syncZoneUploadIssues } from './environment/session-zone-reclaim'
import { canonicalClaimPath } from './environment/sync-zone-paths'
import { gitRun } from './git-run'
import { resolveHarnessHomeRoot } from './harness/home'
import { busyHarnessInstallIds } from './harness/service'
import log from './logger'
import { compactDesktopNodeEventLog, readDesktopNodeEventStats } from './node-host/node-host-controller'
import { applyStorageAction } from './storage-actions'
import { measureStorageInventory, type StorageRoots } from './storage-inventory'
import { listManagedWorktrees, removeUnusedWorktrees, type WorktreeStorageContext } from './storage-worktrees'

function storageRoots(): StorageRoots {
  return {
    userData: app.getPath('userData'),
    logs: app.getPath('logs'),
    harnessHome: resolveHarnessHomeRoot(),
  }
}

function isWithinDir(filePath: string, canonicalDir: string): boolean {
  const target = canonicalClaimPath(filePath)
  return target === canonicalDir || target.startsWith(canonicalDir + sep)
}

export function hasActiveSyncDeliveriesUnder(sessionId: string, dirPath: string): boolean {
  try {
    const dir = canonicalClaimPath(dirPath)
    return listSessionDeliveries(sessionId).some(
      (row) => row.outcome === null && row.gaveUpAt === null && isWithinDir(row.localPath, dir),
    )
  } catch {
    return true
  }
}

export function abandonGivenUpDeliveriesUnder(sessionId: string, dirPath: string): void {
  try {
    const dir = canonicalClaimPath(dirPath)
    const ids = listSessionDeliveries(sessionId)
      .filter((row) => row.outcome === null && row.gaveUpAt !== null && isWithinDir(row.localPath, dir))
      .map((row) => row.deliveryId)
    if (ids.length === 0) return
    const placeholders = ids.map(() => '?').join(', ')
    getDb()
      .prepare(
        `UPDATE session_file_deliveries
         SET outcome = 'abandoned', holder = NULL, epoch = epoch + 1, updated_at = ?
         WHERE delivery_id IN (${placeholders}) AND outcome IS NULL`,
      )
      .run(new Date().toISOString(), ...ids)
  } catch {
    void 0
  }
}

export async function getDesktopStorageInventory(): Promise<StorageInventory> {
  try {
    const [reclaimable, syncIssues] = await Promise.all([
      previewSyncZoneReclaim(),
      syncZoneUploadIssues(),
    ])
    return measureStorageInventory({
      roots: storageRoots(),
      nodeEventStats: readDesktopNodeEventStats(),
      busyHarnessIds: busyHarnessInstallIds(),
      reclaimableSyncSessions: new Set(reclaimable.removed),
      syncIssues,
    })
  } catch (err) {
    log.error('[storage] inventory failed: %s', err instanceof Error ? err.stack ?? err.message : String(err))
    throw err
  }
}

export async function runDesktopStorageAction(action: unknown, harnessId: unknown): Promise<StorageActionResult> {
  try {
    if (!isStorageApplyAction(action)) throw new Error('unknown storage action')
    const browser = session.fromPartition('persist:browser')
    const appSession = session.defaultSession
    return await applyStorageAction(action, {
      roots: storageRoots(),
      ...(typeof harnessId === 'string' ? { harnessId } : {}),
      busyHarnessIds: busyHarnessInstallIds(),
      isSyncDirProtected: hasActiveSyncDeliveriesUnder,
      onSyncDirCleared: abandonGivenUpDeliveriesUnder,
      reclaimSyncZone: async () => (await sweepSyncZone()).freedBytes,
      compactNodeEvents: (vacuum) => compactDesktopNodeEventLog(vacuum),
      clearBrowserCache: () => browser.clearCache(),
      clearBrowserCodeCache: () => browser.clearCodeCaches({}),
      clearBrowserSiteData: () => browser.clearStorageData({
        storages: ['cookies', 'filesystem', 'indexdb', 'localstorage', 'shadercache', 'serviceworkers', 'cachestorage'],
      }),
      clearAppCache: () => appSession.clearCache(),
      clearAppCodeCache: () => appSession.clearCodeCaches({}),
    })
  } catch (err) {
    log.error('[storage] action %s failed: %s', String(action), err instanceof Error ? err.stack ?? err.message : String(err))
    throw err
  }
}

/** Every local path a session or sidebar project still points at. */
function referencedWorktreePaths(): string[] {
  const db = getDb()
  const sessions = db.prepare('SELECT DISTINCT worktree_path AS path FROM sessions WHERE worktree_path IS NOT NULL').all() as { path: string }[]
  const projects = db.prepare('SELECT path FROM projects').all() as { path: string }[]
  return [...sessions, ...projects].map((row) => row.path)
}

function worktreeStorageContext(): WorktreeStorageContext {
  return {
    root: join(homedir(), '.worktrees'),
    git: worktreeGit(gitRun),
    referencedPaths: referencedWorktreePaths,
  }
}

export async function getDesktopStorageWorktrees(): Promise<StorageWorktree[]> {
  try {
    return await listManagedWorktrees(worktreeStorageContext())
  } catch (err) {
    log.error('[storage] worktree listing failed: %s', err instanceof Error ? err.stack ?? err.message : String(err))
    throw err
  }
}

export async function removeDesktopStorageWorktrees(paths: unknown): Promise<StorageWorktreeRemoval> {
  const targets = Array.isArray(paths) ? paths.filter((path): path is string => typeof path === 'string') : []
  const result = await removeUnusedWorktrees(worktreeStorageContext(), targets)
  for (const failure of result.failed) log.warn('[storage] worktree %s was not removed: %s', failure.path, failure.error)
  return result
}
