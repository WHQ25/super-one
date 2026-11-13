import { join } from 'node:path'
import type { StorageActionResult, StorageApplyAction, StorageCompactResult } from '@superone/shared/desktop-storage'
import { directoryBytes, isDirectory, namedChildren, removeTree } from './storage-fs'
import {
  appCacheUsage,
  browserStorageBytes,
  chatBackupFiles,
  logRoots,
  recoveryLeftoverPaths,
  syncProducerDirs,
  unusedHarnessPaths,
  type StorageRoots,
  type SyncProducerTarget,
} from './storage-inventory'

export interface StorageActionContext {
  roots: StorageRoots
  harnessId?: string
  busyHarnessIds?: ReadonlySet<string>
  isSyncDirProtected?: (sessionId: string, dirPath: string) => boolean
  onSyncDirCleared?: (sessionId: string, dirPath: string) => void
  compactNodeEvents: (vacuum: boolean) => Promise<StorageCompactResult> | StorageCompactResult
  clearBrowserCache: () => Promise<void> | void
  clearBrowserCodeCache: () => Promise<void> | void
  clearBrowserSiteData: () => Promise<void> | void
  clearAppCache: () => Promise<void> | void
  clearAppCodeCache: () => Promise<void> | void
}

export async function applyStorageAction(action: StorageApplyAction, ctx: StorageActionContext): Promise<StorageActionResult> {
  switch (action) {
    case 'delete-backups':
      return removed(action, deletePaths(...chatBackupFiles(ctx.roots.userData).all))
    case 'trim-extra-backups':
      return removed(action, deletePaths(...chatBackupFiles(ctx.roots.userData).extras))
    case 'delete-leftovers':
      return removed(action, deletePaths(...recoveryLeftoverPaths(ctx.roots.userData)))
    case 'clear-browser-http-cache':
      return removed(action, await clearMeasured(() => browserStorageBytes(ctx.roots.userData).http, ctx.clearBrowserCache))
    case 'clear-browser-code-cache':
      return removed(action, await clearMeasured(() => browserStorageBytes(ctx.roots.userData).code, ctx.clearBrowserCodeCache))
    case 'clear-browser-site-data':
      return removed(action, await clearMeasured(() => browserStorageBytes(ctx.roots.userData).site, ctx.clearBrowserSiteData))
    case 'compact-node-events': {
      const compact = await ctx.compactNodeEvents(true)
      return { action, removedBytes: compact.freedBytes, compact }
    }
    case 'clear-sync-attachments':
      return removed(action, clearSyncTargets(syncProducerDirs(join(ctx.roots.userData, 'sync')).attachments, ctx))
    case 'clear-sync-media':
      return removed(action, clearSyncTargets(syncProducerDirs(join(ctx.roots.userData, 'sync')).media, ctx))
    case 'clear-app-cache':
      return removed(action, await clearMeasured(() => appCacheUsage(ctx.roots.userData).clearable, async () => {
        await ctx.clearAppCache()
        await ctx.clearAppCodeCache()
      }))
    case 'clear-unused-harness-runtimes':
      return removed(action, deletePaths(...unusedHarnessPaths(ctx.roots.harnessHome, ctx.harnessId, ctx.busyHarnessIds)))
    case 'clear-logs':
      return removed(action, clearLogContents(ctx.roots))
    default: {
      const never: never = action
      throw new Error(`unknown storage action ${String(never)}`)
    }
  }
}

function clearSyncTargets(targets: SyncProducerTarget[], ctx: StorageActionContext): number {
  const allowed = targets.filter((target) => !ctx.isSyncDirProtected?.(target.sessionId, target.path))
  const freed = deletePaths(...allowed.map((target) => target.path))
  for (const target of allowed) {
    ctx.onSyncDirCleared?.(target.sessionId, target.path)
  }
  return freed
}

async function clearMeasured(measure: () => number, clear: () => Promise<void> | void): Promise<number> {
  const before = measure()
  await clear()
  return Math.max(0, before - measure())
}

function deletePaths(...paths: Array<string | null>): number {
  const targets = paths.filter((path): path is string => Boolean(path))
  const before = targets.reduce((sum, path) => sum + directoryBytes(path), 0)
  for (const path of targets) removeTree(path)
  const after = targets.reduce((sum, path) => sum + directoryBytes(path), 0)
  return Math.max(0, before - after)
}

function clearLogContents(roots: StorageRoots): number {
  let freed = 0
  for (const root of logRoots(roots)) {
    if (!isDirectory(root)) continue
    const before = directoryBytes(root)
    for (const name of namedChildren(root)) removeTree(join(root, name))
    freed += Math.max(0, before - directoryBytes(root))
  }
  return freed
}

function removed(action: StorageApplyAction, removedBytes: number): StorageActionResult {
  return { action, removedBytes }
}
