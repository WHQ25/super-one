/**
 * Side-by-side layout for managed harness installs (CLI + desktop).
 *
 * ```
 * <harnessHome>/claude/   (or codex/)
 *   versions/<runtimeVersion>/
 *     install-meta.json
 *     lib/node_modules/...
 *   current                    # { runtimeVersion, installRoot?, updatedAt }
 * ```
 *
 * Offline SuperOne-signed artifacts use `releases/…` (`managed-release.ts`).
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

export const MANAGED_VERSIONS_DIRNAME = 'versions'
export const MANAGED_CURRENT_BASENAME = 'current'
/** Max version dirs retained after a successful switch (current + previous). */
export const MANAGED_VERSION_KEEP = 2

export interface ManagedCurrentPointer {
  runtimeVersion: string
  /** Absolute path to active install root when known. */
  installRoot?: string
  updatedAt?: number
}

/** Reject path traversal / separators in version path segments. */
export function sanitizeRuntimeVersionForPath(runtimeVersion: string): string {
  const v = runtimeVersion.trim()
  if (!v) throw new Error('empty runtime version')
  if (v.includes('..') || v.includes('/') || v.includes('\\') || v.includes('\0')) {
    throw new Error(`unsafe runtime version for path: ${runtimeVersion}`)
  }
  if (!/^[A-Za-z0-9._+-]+$/.test(v)) {
    throw new Error(`unsafe runtime version for path: ${runtimeVersion}`)
  }
  return v
}

export function managedVersionsDir(prefix: string): string {
  return join(prefix, MANAGED_VERSIONS_DIRNAME)
}

export function managedVersionDir(prefix: string, runtimeVersion: string): string {
  return join(managedVersionsDir(prefix), sanitizeRuntimeVersionForPath(runtimeVersion))
}

export function managedCurrentPath(prefix: string): string {
  return join(prefix, MANAGED_CURRENT_BASENAME)
}

export function readCurrentPointer(prefix: string): ManagedCurrentPointer | null {
  const path = managedCurrentPath(prefix)
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      runtimeVersion?: string
      installRoot?: string
      updatedAt?: number
    }
    if (typeof raw.runtimeVersion !== 'string' || !raw.runtimeVersion.trim()) return null
    return {
      runtimeVersion: raw.runtimeVersion.trim(),
      installRoot: typeof raw.installRoot === 'string' ? raw.installRoot : undefined,
      updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : undefined,
    }
  } catch {
    return null
  }
}

/** Atomic-ish pointer update (temp file + rename). */
export function writeCurrentPointer(
  prefix: string,
  runtimeVersion: string,
  extras?: { installRoot?: string },
): void {
  const ver = sanitizeRuntimeVersionForPath(runtimeVersion)
  mkdirSync(prefix, { recursive: true })
  const path = managedCurrentPath(prefix)
  const body = JSON.stringify(
    {
      runtimeVersion: ver,
      installRoot: extras?.installRoot,
      updatedAt: Date.now(),
    } satisfies ManagedCurrentPointer,
    null,
    2,
  )
  const tmp = join(
    prefix,
    `.${MANAGED_CURRENT_BASENAME}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`,
  )
  writeFileSync(tmp, body)
  try {
    renameSync(tmp, path)
  } catch {
    try {
      if (existsSync(path)) rmSync(path, { force: true })
      renameSync(tmp, path)
    } catch {
      writeFileSync(path, body)
      try {
        rmSync(tmp, { force: true })
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Resolve the filesystem root that holds `lib/` for this managed install.
 * Requires `current` → `versions/<ver>/` (or a sole version dir).
 */
export function resolveActiveInstallRoot(prefix: string): string | null {
  if (!prefix || !existsSync(prefix)) return null

  const pointer = readCurrentPointer(prefix)
  if (pointer) {
    if (
      pointer.installRoot &&
      existsSync(pointer.installRoot) &&
      statSync(pointer.installRoot).isDirectory()
    ) {
      return pointer.installRoot
    }
    const dir = managedVersionDir(prefix, pointer.runtimeVersion)
    if (existsSync(dir) && statSync(dir).isDirectory()) return dir
  }

  const versionsRoot = managedVersionsDir(prefix)
  if (existsSync(versionsRoot)) {
    try {
      const kids = readdirSync(versionsRoot).filter((n) => {
        try {
          return statSync(join(versionsRoot, n)).isDirectory()
        } catch {
          return false
        }
      })
      if (kids.length === 1) return join(versionsRoot, kids[0]!)
    } catch {
      /* ignore */
    }
  }

  return null
}

/** Drop old version dirs, keeping `keep` (plus fill up to maxKeep by mtime). */
export function pruneManagedVersions(
  prefix: string,
  keep: string[],
  maxKeep = MANAGED_VERSION_KEEP,
): void {
  const versionsRoot = managedVersionsDir(prefix)
  if (!existsSync(versionsRoot)) return

  const keepSet = new Set(
    keep
      .filter(Boolean)
      .map((v) => {
        try {
          return sanitizeRuntimeVersionForPath(v)
        } catch {
          return ''
        }
      })
      .filter(Boolean),
  )

  let entries: Array<{ name: string; mtime: number }>
  try {
    entries = readdirSync(versionsRoot)
      .map((name) => {
        try {
          const st = statSync(join(versionsRoot, name))
          if (!st.isDirectory()) return null
          return { name, mtime: st.mtimeMs }
        } catch {
          return null
        }
      })
      .filter((e): e is { name: string; mtime: number } => e != null)
  } catch {
    return
  }

  const protectedNames = entries.filter((e) => keepSet.has(e.name))
  const others = entries
    .filter((e) => !keepSet.has(e.name))
    .sort((a, b) => b.mtime - a.mtime)

  const retain = new Set(protectedNames.map((e) => e.name))
  for (const e of others) {
    if (retain.size >= maxKeep) break
    retain.add(e.name)
  }

  for (const e of entries) {
    if (retain.has(e.name)) continue
    const dir = join(versionsRoot, e.name)
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* best-effort */
    }
  }
}
