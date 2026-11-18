import { readdirSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { isManagedHarnessId } from '@superone/runtime/harness'
import {
  MANAGED_VERSIONS_DIRNAME,
  readCurrentPointer,
  sanitizeRuntimeVersionForPath,
} from '@superone/runtime/harness/managed-layout'
import {
  isRetiredHarness,
  type StorageCategory,
  type StorageCategoryId,
  type StorageInventory,
  type StorageNodeEvents,
  type StorageSyncIssues,
} from '@superone/shared/desktop-storage'
import { listBackups, type BackupEntry } from './db-backup'
import {
  directoryBytes,
  entryBytes,
  exists,
  fileBytes,
  isDirectory,
  mtimeMs,
  namedChildren,
} from './storage-fs'

export { directoryBytes }

export interface StorageRoots {
  userData: string
  logs: string
  harnessHome: string
}

export interface StorageMeasureOptions {
  roots: StorageRoots
  nodeEventStats?: StorageNodeEvents | null
  busyHarnessIds?: ReadonlySet<string>
  reclaimableSyncSessions?: ReadonlySet<string>
  syncIssues?: StorageSyncIssues
}

export interface SyncProducerTarget {
  sessionId: string
  path: string
}

export interface SyncProducerDirs {
  attachments: SyncProducerTarget[]
  media: SyncProducerTarget[]
}

export interface HarnessRuntimeUsage {
  id: string
  path: string
  bytes: number
  unusedBytes: number
  unusedPaths: string[]
}

const APP_CACHE_NAMES = ['Cache', 'Code Cache', 'GPUCache'] as const
const BROWSER_HTTP = new Set(['Cache'])
const BROWSER_CODE = new Set(['Code Cache'])
const BROWSER_SITE = new Set([
  'Local Storage',
  'Session Storage',
  'IndexedDB',
  'Service Worker',
  'File System',
  'Shared Dictionary',
  'blob_storage',
  'databases',
  'WebStorage',
  'Storage',
  'Cookies',
  'Cookies-journal',
])
const ZONE_SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function measureStorageInventory(options: StorageMeasureOptions): StorageInventory {
  const { roots } = options
  const userData = roots.userData
  const categories: StorageCategory[] = []

  const chatPath = join(userData, 'superone.db')
  const cursorBytes = directoryBytes(join(userData, 'cursor-sdk'))
  categories.push({
    id: 'chat-database',
    bytes: fileBytes(chatPath) + fileBytes(`${chatPath}-wal`) + fileBytes(`${chatPath}-shm`) + cursorBytes,
    ...(exists(chatPath) ? { path: chatPath } : {}),
    actions: exists(chatPath) ? ['reveal'] : [],
  })

  const backupDir = join(userData, 'backups')
  const chatBackups = chatBackupFiles(userData)
  const backupBytes = chatBackups.all.reduce((sum, path) => sum + fileBytes(path), 0)
  if (backupBytes > 0) {
    categories.push({
      id: 'backup',
      bytes: backupBytes,
      unusedBytes: chatBackups.extras.reduce((sum, path) => sum + fileBytes(path), 0),
      path: backupDir,
      count: chatBackups.all.length,
      actions: ['reveal', 'delete-backups'],
    })
  }

  const leftovers = recoveryLeftoverPaths(userData)
  const leftoverBytes = leftovers.reduce((sum, path) => sum + fileBytes(path), 0)
  if (leftoverBytes > 0) {
    categories.push({
      id: 'recovery-leftovers',
      bytes: leftoverBytes,
      path: leftovers[0],
      count: leftovers.length,
      actions: ['reveal', 'delete-leftovers'],
    })
  }

  const browserRoot = join(userData, 'Partitions', 'browser')
  const browser = browserBytes(browserRoot)
  categories.push(browserCategory('browser-http-cache', browser.http, browserRoot, 'clear-browser-http-cache'))
  categories.push(browserCategory('browser-code-cache', browser.code, browserRoot, 'clear-browser-code-cache'))
  categories.push(browserCategory('browser-site-data', browser.site, browserRoot, 'clear-browser-site-data'))

  const nodePath = join(userData, 'node-host', 'node.db')
  const nodeBytes = fileBytes(nodePath) + fileBytes(`${nodePath}-wal`) + fileBytes(`${nodePath}-shm`)
  categories.push({
    id: 'node-event-log',
    bytes: nodeBytes,
    ...(exists(nodePath) ? { path: nodePath } : {}),
    ...(options.nodeEventStats ? { count: options.nodeEventStats.rows } : {}),
    actions: ['compact-node-events', ...(exists(nodePath) ? ['reveal' as const] : [])],
  })

  const syncRoot = join(userData, 'sync')
  const sync = syncProducerDirs(syncRoot)
  categories.push(syncCategory('sync-attachments', sync.attachments, syncRoot, 'clear-sync-attachments', options.reclaimableSyncSessions))
  categories.push(syncCategory('sync-media', sync.media, syncRoot, 'clear-sync-media', options.reclaimableSyncSessions))

  const appCache = appCacheUsage(userData)
  const appCachePath = appCacheDirs(userData).find((path) => exists(path))
  categories.push({
    id: 'app-cache',
    bytes: appCache.total,
    unusedBytes: appCache.clearable,
    ...(appCachePath ? { path: appCachePath } : {}),
    actions: ['clear-app-cache', ...(appCachePath ? ['reveal' as const] : [])],
  })

  const harnessUsage = harnessRuntimeUsage(roots.harnessHome, options.busyHarnessIds)
  const harnessRuntimes = harnessUsage.map((row) => ({
    id: row.id,
    path: row.path,
    bytes: row.bytes,
    unusedBytes: row.unusedBytes,
  }))
  harnessRuntimes.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
  const rootDownloadBytes = rootDownloadPaths(roots.harnessHome).reduce((sum, path) => sum + entryBytes(path), 0)
  const harnessBytes = harnessRuntimes.reduce((sum, row) => sum + row.bytes, 0) + rootDownloadBytes
  const unusedBytes = unusedHarnessPaths(roots.harnessHome, undefined, options.busyHarnessIds)
    .reduce((sum, path) => sum + entryBytes(path), 0)
  if (harnessBytes > 0) {
    categories.push({
      id: 'harness-runtimes',
      bytes: harnessBytes,
      unusedBytes,
      path: roots.harnessHome,
      actions: ['reveal', 'clear-unused-harness-runtimes'],
    })
  }

  const logs = logRoots(roots).filter((path) => exists(path))
  categories.push({
    id: 'logs',
    bytes: logs.reduce((sum, path) => sum + directoryBytes(path), 0),
    ...(logs[0] ? { path: logs[0] } : {}),
    actions: ['clear-logs', ...(logs[0] ? ['reveal' as const] : [])],
  })

  return {
    categories,
    harnessRuntimes,
    nodeEvents: options.nodeEventStats ?? null,
    ...(options.syncIssues ? { syncIssues: options.syncIssues } : {}),
  }
}

export function chatBackupFiles(userData: string): { retained: string | null; extras: string[]; all: string[] } {
  const dir = join(userData, 'backups')
  const backups = listBackups(dir)
  const retained = newestOfHighestSchema(backups)?.path ?? null
  const extras = [
    ...backups.filter((entry) => entry.path !== retained).map((entry) => entry.path),
    ...namedChildren(dir).filter((name) => name.endsWith('.tmp')).map((name) => join(dir, name)),
  ]
  return { retained, extras, all: [...(retained ? [retained] : []), ...extras] }
}

export function recoveryLeftoverPaths(userData: string): string[] {
  return namedChildren(userData)
    .filter((name) => /^superone\.(corrupt-|newer-schema).+\.db(-wal|-shm)?$/.test(name))
    .map((name) => join(userData, name))
}

export function appCacheDirs(userData: string): string[] {
  return APP_CACHE_NAMES.map((name) => join(userData, name))
}

export function appCacheUsage(userData: string): { total: number; clearable: number } {
  const http = directoryBytes(join(userData, 'Cache'))
  const code = directoryBytes(join(userData, 'Code Cache'))
  const gpu = directoryBytes(join(userData, 'GPUCache'))
  return { total: http + code + gpu, clearable: http + code }
}

export function logRoots(roots: StorageRoots): string[] {
  const extra = join(roots.userData, 'logs')
  return roots.logs === extra ? [roots.logs] : [roots.logs, extra]
}

export function syncProducerDirs(syncRoot: string): SyncProducerDirs {
  const found: SyncProducerDirs = { attachments: [], media: [] }
  let sessions: Dirent[]
  try {
    sessions = readdirSync(syncRoot, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of sessions) {
    if (entry.isSymbolicLink() || !entry.isDirectory()) continue
    const sessionId = entry.name
    if (!ZONE_SESSION_ID_RE.test(sessionId) || sessionId === '.' || sessionId === '..') continue
    const sessionDir = join(syncRoot, sessionId)
    const attachmentDir = join(sessionDir, 'attachment')
    if (isDirectory(attachmentDir)) found.attachments.push({ sessionId, path: attachmentDir })
    const mediaDir = join(sessionDir, 'media-gen')
    if (isDirectory(mediaDir)) found.media.push({ sessionId, path: mediaDir })
  }
  return found
}

export function harnessRuntimeUsage(root: string, busyHarnessIds?: ReadonlySet<string>): HarnessRuntimeUsage[] {
  const rows: HarnessRuntimeUsage[] = []
  for (const name of namedChildren(root)) {
    if (!isStorageHarnessId(name)) continue
    const path = join(root, name)
    if (!isDirectory(path)) continue
    if (isRetiredHarness(name)) {
      const bytes = directoryBytes(path)
      const paths = bytes > 0 ? [path] : []
      rows.push({
        id: name,
        path,
        bytes,
        unusedBytes: bytes,
        unusedPaths: paths,
      })
      continue
    }
    const installing = Boolean(busyHarnessIds?.has(name)) || hasActiveExtract(path)
    const unusedPaths = installing ? [] : [...pathsBeyondKeep(path, 1), ...emptyExtractDirectories(path)]
    rows.push({
      id: name,
      path,
      bytes: directoryBytes(path),
      unusedBytes: unusedPaths.reduce((sum, item) => sum + entryBytes(item), 0),
      unusedPaths,
    })
  }
  return rows.sort((a, b) => (a.id < b.id ? -1 : 1))
}

export function unusedHarnessPaths(root: string, harnessId?: string, busyHarnessIds?: ReadonlySet<string>): string[] {
  if (harnessId) {
    if (!isStorageHarnessId(harnessId)) return []
    return harnessRuntimeUsage(root, busyHarnessIds).find((row) => row.id === harnessId)?.unusedPaths ?? []
  }
  const rows = harnessRuntimeUsage(root, busyHarnessIds)
  const unused = rows.flatMap((row) => row.unusedPaths)
  const anyInstalling = (busyHarnessIds?.size ?? 0) > 0 || rows.some((row) => !isRetiredHarness(row.id) && hasActiveExtract(row.path))
  if (!anyInstalling) {
    unused.push(...rootDownloadPaths(root))
  }
  return unused
}

function rootDownloadPaths(root: string): string[] {
  const paths: string[] = []
  for (const name of namedChildren(root)) {
    const full = join(root, name)
    if (isDownload(name) && exists(full)) paths.push(full)
  }
  return paths
}

function extractDirectories(prefix: string): string[] {
  return namedChildren(prefix)
    .filter((name) => name.startsWith('.extract-'))
    .map((name) => join(prefix, name))
    .filter((path) => isDirectory(path))
}

/** A non-empty extract dir is an install in progress. An empty one is a leftover. */
function hasActiveExtract(prefix: string): boolean {
  return extractDirectories(prefix).some((path) => namedChildren(path).length > 0)
}

function emptyExtractDirectories(prefix: string): string[] {
  return extractDirectories(prefix).filter((path) => namedChildren(path).length === 0)
}

function pathsBeyondKeep(path: string, keepCount: number): string[] {
  const unused: string[] = []
  const versionsDir = join(path, MANAGED_VERSIONS_DIRNAME)
  if (!isDirectory(versionsDir)) {
    collectDownloads(path, unused)
    return unused
  }
  const pointer = readCurrentPointer(path)
  const versions = namedChildren(versionsDir)
    .map((version) => ({ name: version, path: join(versionsDir, version) }))
    .filter((version) => isDirectory(version.path))
    .map((version) => ({ ...version, mtime: mtimeMs(version.path) }))
    .sort((a, b) => b.mtime - a.mtime || (a.name < b.name ? -1 : 1))

  const keep = protectedVersionNames(pointer, versions)
  for (const version of versions) {
    if (keep.size >= keepCount) break
    keep.add(version.name)
  }
  const kept = new Set<string>()
  for (const version of versions) {
    if (keep.has(version.name)) {
      kept.add(version.path)
      collectDownloads(version.path, unused)
    } else {
      unused.push(version.path)
    }
  }
  collectDownloads(path, unused, new Set([versionsDir, ...kept, ...versions.map((version) => version.path)]))
  return unused
}

function protectedVersionNames(
  pointer: ReturnType<typeof readCurrentPointer>,
  versions: readonly { name: string; path: string }[],
): Set<string> {
  const names = new Set<string>()
  if (!pointer) return names
  if (pointer.installRoot) {
    const activeRoot = resolve(pointer.installRoot)
    for (const version of versions) {
      const resolvedVersion = resolve(version.path)
      if (activeRoot === resolvedVersion || activeRoot.startsWith(resolvedVersion + sep)) {
        names.add(version.name)
      }
    }
  }
  if (pointer.runtimeVersion) {
    let candidate = pointer.runtimeVersion.trim()
    try {
      candidate = sanitizeRuntimeVersionForPath(candidate)
    } catch {
      candidate = ''
    }
    if (candidate && versions.some((version) => version.name === candidate)) {
      names.add(candidate)
    }
  }
  return names
}

function isStorageHarnessId(name: string): boolean {
  return isManagedHarnessId(name) || isRetiredHarness(name)
}

function browserCategory(
  id: StorageCategoryId,
  bytes: number,
  path: string,
  action: StorageCategory['actions'][number],
): StorageCategory {
  return {
    id,
    bytes,
    ...(exists(path) ? { path } : {}),
    actions: [action, ...(exists(path) ? ['reveal' as const] : [])],
  }
}

function syncCategory(
  id: StorageCategoryId,
  dirs: SyncProducerTarget[],
  syncRoot: string,
  action: StorageCategory['actions'][number],
  reclaimableSessions?: ReadonlySet<string>,
): StorageCategory {
  let bytes = 0
  let unusedBytes = 0
  for (const entry of dirs) {
    const size = directoryBytes(entry.path)
    bytes += size
    if (reclaimableSessions?.has(entry.sessionId)) unusedBytes += size
  }
  return {
    id,
    bytes,
    ...(reclaimableSessions ? { unusedBytes } : {}),
    ...(exists(syncRoot) ? { path: syncRoot } : {}),
    count: dirs.length,
    actions: [action, ...(exists(syncRoot) ? ['reveal' as const] : [])],
  }
}

function newestOfHighestSchema(entries: BackupEntry[]): BackupEntry | null {
  if (entries.length === 0) return null
  const best = Math.max(...entries.map((entry) => entry.schemaVersion))
  return entries.find((entry) => entry.schemaVersion === best) ?? null
}

export function browserStorageBytes(userData: string): { http: number; code: number; site: number } {
  return browserBytes(join(userData, 'Partitions', 'browser'))
}

function browserBytes(root: string): { http: number; code: number; site: number } {
  if (!isDirectory(root)) return { http: 0, code: 0, site: 0 }
  const totals = { http: 0, code: 0, site: 0 }
  for (const name of namedChildren(root)) {
    const path = join(root, name)
    const bytes = entryBytes(path)
    if (BROWSER_HTTP.has(name)) totals.http += bytes
    else if (BROWSER_CODE.has(name)) totals.code += bytes
    else if (BROWSER_SITE.has(name)) totals.site += bytes
  }
  return totals
}

function collectDownloads(dir: string, unused: string[], skip = new Set<string>()): void {
  if (!isDirectory(dir)) return
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (skip.has(path) || entry.isSymbolicLink()) continue
    if (isDownload(entry.name)) {
      unused.push(path)
      continue
    }
    if (entry.isDirectory()) collectDownloads(path, unused, skip)
  }
}

function isDownload(name: string): boolean {
  return name === '.download' || name.endsWith('.download')
}
