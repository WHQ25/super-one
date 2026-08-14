import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

/** Packaged Electron userData directory name (matches `app.setName('SuperOne')`). */
export const PRODUCT_USER_DATA_DIR = 'SuperOne'
/** Historical kebab-case userData from before the product-name alignment. */
export const LEGACY_USER_DATA_DIR = 'super-one'

const PRODUCT_MARKERS = ['superone.db', 'app-settings.json'] as const
const JUNK_NAMES = new Set(['.DS_Store', 'Thumbs.db'])

export type UserDataMigrationAction =
  | 'none'
  | 'renamed'
  | 'merged'
  | 'already-canonical'
  | 'kept-legacy'

export interface ResolveUserDataOptions {
  appData: string
  instance?: string | null
}

export interface ResolveUserDataResult {
  path: string
  action: UserDataMigrationAction
  error?: string
}

export function packagedUserDataPaths(options: ResolveUserDataOptions): {
  dest: string
  legacy: string
} {
  const destBase = join(options.appData, PRODUCT_USER_DATA_DIR)
  const legacyBase = join(options.appData, LEGACY_USER_DATA_DIR)
  const instance = options.instance?.trim()
  if (!instance) return { dest: destBase, legacy: legacyBase }
  return {
    dest: join(destBase, `instance-${instance}`),
    legacy: join(legacyBase, `instance-${instance}`),
  }
}

/**
 * Point packaged builds at `SuperOne` and, when needed, move the historical
 * `super-one` tree into it. Failure keeps the legacy path so a botched rename
 * cannot start the app against an empty SuperOne directory.
 */
export function resolveAndMigrateUserData(options: ResolveUserDataOptions): ResolveUserDataResult {
  const { dest, legacy } = packagedUserDataPaths(options)
  if (!existsSync(legacy)) {
    return { path: dest, action: 'none' }
  }

  if (!existsSync(dest)) {
    try {
      mkdirSync(dirname(dest), { recursive: true })
      renameSync(legacy, dest)
      return { path: dest, action: 'renamed' }
    } catch (err) {
      return { path: legacy, action: 'kept-legacy', error: errorMessage(err) }
    }
  }

  if (!isDirectory(dest)) {
    return {
      path: legacy,
      action: 'kept-legacy',
      error: `${PRODUCT_USER_DATA_DIR} exists and is not a directory`,
    }
  }

  const destWasCanonical = isCanonicalUserData(dest)
  try {
    mergeMissing(legacy, dest)
    tryRemoveEmptyTree(legacy)
  } catch (err) {
    if (isCanonicalUserData(dest)) {
      return { path: dest, action: destWasCanonical ? 'already-canonical' : 'merged', error: errorMessage(err) }
    }
    return { path: legacy, action: 'kept-legacy', error: errorMessage(err) }
  }

  if (isCanonicalUserData(dest) || !existsSync(legacy)) {
    return { path: dest, action: destWasCanonical ? 'already-canonical' : 'merged' }
  }

  return {
    path: legacy,
    action: 'kept-legacy',
    error: `incomplete migration from ${legacy}`,
  }
}

function isCanonicalUserData(dir: string): boolean {
  return PRODUCT_MARKERS.some((name) => fileHasContent(join(dir, name)))
}

function mergeMissing(fromDir: string, toDir: string): void {
  for (const name of readdirSync(fromDir)) {
    const from = join(fromDir, name)
    const to = join(toDir, name)
    if (!existsSync(to)) {
      renameSync(from, to)
      continue
    }
    if (canReplaceEmptyFile(from, to)) {
      unlinkSync(to)
      renameSync(from, to)
    }
  }
}

function canReplaceEmptyFile(from: string, to: string): boolean {
  try {
    const fromStat = statSync(from)
    const toStat = statSync(to)
    return fromStat.isFile() && toStat.isFile() && toStat.size === 0 && fromStat.size > 0
  } catch {
    return false
  }
}

function tryRemoveEmptyTree(dir: string): void {
  if (!existsSync(dir) || !isDirectory(dir)) return
  for (const name of readdirSync(dir)) {
    const child = join(dir, name)
    if (isDirectory(child)) {
      tryRemoveEmptyTree(child)
    } else if (JUNK_NAMES.has(name)) {
      try {
        unlinkSync(child)
      } catch {
        // Leave junk in place; the leftover directory is harmless.
      }
    }
  }
  try {
    if (readdirSync(dir).length === 0) rmdirSync(dir)
  } catch {
    // Parent still has real leftover files, or another process touched it.
  }
}

function fileHasContent(path: string): boolean {
  try {
    const stat = statSync(path)
    return stat.isFile() && stat.size > 0
  } catch {
    return false
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
