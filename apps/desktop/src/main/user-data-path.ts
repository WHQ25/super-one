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

/**
 * Historical kebab-case userData, from before the product-name alignment. Only
 * the variant that inherited the original app identity ever had one -- see
 * `legacyDataDirName` in `variants.json`.
 */
export const LEGACY_USER_DATA_DIR = 'super-one'

const PRODUCT_MARKERS = ['superone.db', 'app-settings.json'] as const
const JUNK_NAMES = new Set(['.DS_Store', 'Thumbs.db'])

export type UserDataMigrationAction =
  | 'none'
  | 'renamed'
  | 'merged'
  | 'already-canonical'
  | 'kept-legacy'

export interface UserDataPathOptions {
  /** OS application-data root (`app.getPath('appData')`). */
  appData: string
  /**
   * Variant-scoped directory name (`variant().dataDirName`).
   *
   * This is the whole of SuperOne's data isolation between the side-by-side
   * stable and alpha apps, and it has to be passed explicitly: Electron
   * computes `userData` from package.json during init, before main runs, so
   * `app.setName()` does NOT move it. The caller must `app.setPath` this.
   */
  dataDirName: string
  /**
   * Optional extra isolation within one variant (`SUPERONE_INSTANCE`).
   * Used by the e2e harness so a test run cannot touch a real profile.
   */
  instance?: string | null
}

export interface ResolveUserDataOptions extends UserDataPathOptions {
  /**
   * The pre-variant directory this variant inherits, or null when it has none.
   *
   * Only `stable` inherits one. It is not enough that stable keeps the same
   * appId and productName: a client that never ran the version which did the
   * rename -- or whose rename failed and landed on `kept-legacy` -- still has
   * its sessions and credentials under the old name, and updates in place into
   * this build.
   */
  legacyDataDirName?: string | null
}

/** Where this variant's profile lives, with no migration attempted. */
export function packagedUserDataPath(options: UserDataPathOptions): string {
  const base = join(options.appData, options.dataDirName)
  const instance = options.instance?.trim()
  return instance ? join(base, `instance-${instance}`) : base
}

export interface ResolveUserDataResult {
  path: string
  action: UserDataMigrationAction
  error?: string
}

export function packagedUserDataPaths(options: ResolveUserDataOptions): {
  dest: string
  legacy: string | null
} {
  const dest = packagedUserDataPath(options)
  const legacyDirName = options.legacyDataDirName
  if (!legacyDirName) return { dest, legacy: null }
  return {
    dest,
    legacy: packagedUserDataPath({ ...options, dataDirName: legacyDirName }),
  }
}

/**
 * Point a packaged build at its variant profile and, when that variant
 * inherits one, move the historical tree into it.
 *
 * Failure keeps the legacy path: starting against an empty profile looks
 * exactly like data loss to the user, and is worse than running from the old
 * directory for one more release.
 */
export function resolveAndMigrateUserData(options: ResolveUserDataOptions): ResolveUserDataResult {
  const { dest, legacy } = packagedUserDataPaths(options)
  if (legacy === null || !existsSync(legacy)) {
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
      error: `${options.dataDirName} exists and is not a directory`,
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
