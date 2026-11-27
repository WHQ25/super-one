export const STORAGE_CATEGORY_IDS = [
  'chat-database',
  'backup',
  'recovery-leftovers',
  'browser-http-cache',
  'browser-code-cache',
  'browser-site-data',
  'node-event-log',
  'sync-attachments',
  'sync-media',
  'app-cache',
  'cursor-sdk',
  'harness-runtimes',
  'logs',
] as const

export type StorageCategoryId = (typeof STORAGE_CATEGORY_IDS)[number]

export const RETIRED_HARNESS_IDS = ['acp-antigravity'] as const

export function isRetiredHarness(id: string): boolean {
  return (RETIRED_HARNESS_IDS as readonly string[]).includes(id)
}

export const STORAGE_ACTIONS = [
  'reveal',
  'delete-backups',
  'trim-extra-backups',
  'delete-leftovers',
  'clear-browser-http-cache',
  'clear-browser-code-cache',
  'clear-browser-site-data',
  'compact-node-events',
  'clear-sync-attachments',
  'clear-sync-media',
  'reclaim-sync-zone',
  'clear-app-cache',
  'clear-unused-harness-runtimes',
  'clear-logs',
] as const

export type StorageAction = (typeof STORAGE_ACTIONS)[number]

export const STORAGE_APPLY_ACTIONS = STORAGE_ACTIONS.filter((action) => action !== 'reveal')

export type StorageApplyAction = (typeof STORAGE_APPLY_ACTIONS)[number]

export function isStorageApplyAction(value: unknown): value is StorageApplyAction {
  return typeof value === 'string' && (STORAGE_APPLY_ACTIONS as readonly string[]).includes(value)
}

export interface StorageCategory {
  id: StorageCategoryId
  bytes: number
  path?: string
  count?: number
  unusedBytes?: number
  actions: StorageAction[]
}

export interface StorageNodeEvents {
  rows: number
  retentionFloor: string
  lastCompactAt: number | null
  lastFreedBytes: number | null
}

export interface StorageHarnessRuntime {
  id: string
  bytes: number
  unusedBytes: number
  path: string
}

export interface StorageSyncIssues {
  failedHandoffs: { files: number; bytes: number; lastError: string | null }
  needsRedelivery: { files: number; bytes: number }
}

export interface StorageInventory {
  categories: StorageCategory[]
  harnessRuntimes?: StorageHarnessRuntime[]
  nodeEvents: StorageNodeEvents | null
  syncIssues?: StorageSyncIssues
}

export interface StorageCompactResult {
  removedRows: number
  freedBytes: number
  floor: string
  vacuum: 'done' | 'skipped' | 'not-requested'
}

export interface StorageActionResult {
  action: StorageApplyAction
  removedBytes: number
  compact?: StorageCompactResult
}

/** A SuperOne-created worktree under `~/.worktrees`. */
export interface StorageWorktree {
  path: string
  /** Directory name of the repository it was cut from. */
  repo: string
  /** Checked-out branch; null when detached or unreadable. */
  branch: string | null
  bytes: number
  /** A session or project still points at it; it cannot be removed here. */
  inUse: boolean
  /** Has uncommitted changes that removal would discard. */
  dirty: boolean
}

export interface StorageWorktreeRemoval {
  removed: string[]
  failed: { path: string; error: string }[]
}

export interface StorageArchivedProject {
  id: string
  name: string
  path: string
  hiddenAt: string
  sessionCount: number
  messageCount: number
}
