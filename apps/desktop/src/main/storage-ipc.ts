import { sep } from 'node:path'
import { app, session } from 'electron'
import {
  isStorageApplyAction,
  type StorageActionResult,
  type StorageInventory,
} from '@superone/shared/desktop-storage'
import { getDb } from './database'
import { listSessionDeliveries } from './db-session-deliveries'
import { canonicalClaimPath } from './environment/sync-zone-paths'
import { resolveHarnessHomeRoot } from './harness/home'
import { busyHarnessInstallIds } from './harness/service'
import log from './logger'
import { compactDesktopNodeEventLog, readDesktopNodeEventStats } from './node-host/node-host-controller'
import { applyStorageAction } from './storage-actions'
import { measureStorageInventory, type StorageRoots } from './storage-inventory'

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

export function getDesktopStorageInventory(): StorageInventory {
  try {
    return measureStorageInventory({
      roots: storageRoots(),
      nodeEventStats: readDesktopNodeEventStats(),
      busyHarnessIds: busyHarnessInstallIds(),
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
