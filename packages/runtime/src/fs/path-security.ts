import { realpathSync, existsSync, lstatSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, normalize, resolve, sep } from 'node:path'

/**
 * Resolve a project-relative path and ensure it stays inside the project root.
 * Fails closed on symlink escape and traversal.
 */
export function resolveProjectPath(
  projectRoot: string,
  relativePath: string,
): { ok: true; absolutePath: string } | { ok: false; reason: string } {
  if (relativePath.includes('\0')) {
    return { ok: false, reason: 'null byte in path' }
  }
  let root = resolve(projectRoot)
  try {
    if (existsSync(root)) root = realpathSync(root)
  } catch {
    /* keep resolved root */
  }
  if (isAbsolute(relativePath)) {
    return { ok: false, reason: 'absolute paths are not allowed' }
  }
  const candidate = normalize(join(root, relativePath))
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    return { ok: false, reason: 'path escapes project root' }
  }

  try {
    if (existsSync(candidate)) {
      const real = realpathSync(candidate)
      if (real !== root && !real.startsWith(root + sep)) {
        return { ok: false, reason: 'symlink escapes project root' }
      }
      return { ok: true, absolutePath: real }
    }
    // Missing path: realpath the nearest existing ancestor, then re-append the
    // remaining relative segments. Do NOT pass a leading-sep suffix to join() —
    // path.join('/proj', '/src/new.ts') is '/src/new.ts' on POSIX and drops root.
    let parent = resolve(candidate, '..')
    while (parent === root || parent.startsWith(root + sep)) {
      if (existsSync(parent)) {
        const realParent = realpathSync(parent)
        if (realParent !== root && !realParent.startsWith(root + sep)) {
          return { ok: false, reason: 'parent symlink escapes project root' }
        }
        const remainder =
          candidate === parent
            ? ''
            : candidate.slice(parent.length + (candidate.startsWith(parent + sep) ? sep.length : 0))
        const absolutePath = remainder ? join(realParent, remainder) : realParent
        // remainder is relative (no leading sep); join stays under realParent (already under root).
        if (
          absolutePath !== realParent &&
          !absolutePath.startsWith(realParent + sep) &&
          absolutePath !== root &&
          !absolutePath.startsWith(root + sep)
        ) {
          return { ok: false, reason: 'path escapes project root' }
        }
        return { ok: true, absolutePath }
      }
      if (parent === root) break
      const next = resolve(parent, '..')
      if (next === parent) break
      parent = next
    }
    return { ok: true, absolutePath: candidate }
  } catch (err) {
    return { ok: false, reason: (err as Error).message || 'path resolution failed' }
  }
}

export function assertInsideRoot(root: string, absolutePath: string): boolean {
  const r = resolve(root)
  const a = resolve(absolutePath)
  return a === r || a.startsWith(r + sep)
}

/** Project-relative prefix for agent tool output files (bash / task tails). */
export const TOOL_OUTPUT_REL_PREFIX = 'temp/'

/**
 * Normalize a project-relative path for comparisons (POSIX separators, no leading ./).
 * Collapses `.` / `..` segments so `temp/../src` cannot spoof the temp/ prefix.
 */
export function normalizeProjectRelativePath(relativePath: string): string {
  const raw = relativePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
  if (!raw || raw === '.') return '.'
  const parts: string[] = []
  for (const seg of raw.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      if (parts.length === 0) return '..' // escapes root — not a safe project-relative path
      parts.pop()
      continue
    }
    parts.push(seg)
  }
  return parts.join('/') || '.'
}

/**
 * Tool-output tail watches are limited to paths under `temp/` inside the project root.
 * Absolute paths and project-relative paths outside that prefix are rejected.
 */
export function isToolOutputRelativePath(relativePath: string): boolean {
  const n = normalizeProjectRelativePath(relativePath)
  if (n === '.' || n === '' || n === '..' || n.startsWith('../')) return false
  return n === 'temp' || n.startsWith(TOOL_OUTPUT_REL_PREFIX)
}

/**
 * If `absoluteOrRelative` is absolute under `projectRoot`, return the project-relative form.
 * If already relative, normalize and return. Returns null when outside the project root.
 */
export function toProjectRelativePath(
  projectRoot: string,
  absoluteOrRelative: string,
): string | null {
  if (!absoluteOrRelative || absoluteOrRelative.includes('\0')) return null
  const normalized = absoluteOrRelative.replace(/\\/g, '/')
  if (!isAbsolute(absoluteOrRelative) && !normalized.startsWith('/')) {
    return normalizeProjectRelativePath(normalized)
  }
  const root = resolve(projectRoot)
  const abs = resolve(absoluteOrRelative)
  if (abs === root) return '.'
  if (!abs.startsWith(root + sep)) return null
  return abs.slice(root.length + sep.length).split(/[/\\]/).join('/')
}

export function pathKind(absolutePath: string): 'file' | 'directory' | 'symlink' | 'other' {
  try {
    const st = lstatSync(absolutePath)
    if (st.isSymbolicLink()) return 'symlink'
    if (st.isDirectory()) return 'directory'
    if (st.isFile()) return 'file'
    return 'other'
  } catch {
    try {
      const st = statSync(absolutePath)
      if (st.isDirectory()) return 'directory'
      if (st.isFile()) return 'file'
      return 'other'
    } catch {
      return 'other'
    }
  }
}

function normalizeSep(p: string): string {
  return sep === '\\' ? p.replace(/\//g, '\\') : p
}

/** Resolve realpath when possible (desktop asset / allowlist helpers). */
export function resolveRealPath(inputPath: string): string {
  const absPath = resolve(inputPath)
  try {
    return realpathSync(absPath)
  } catch {
    return absPath
  }
}

export function isPathWithinAllowed(filePath: string, allowedRoots: string[]): boolean {
  const real = normalizeSep(resolveRealPath(filePath))
  return allowedRoots.some((root) => real.startsWith(normalizeSep(resolveRealPath(root)) + sep))
}

export function isPathAtOrWithinAllowed(filePath: string, allowedRoots: string[]): boolean {
  const real = normalizeSep(resolveRealPath(filePath))
  return allowedRoots.some((root) => {
    const r = normalizeSep(resolveRealPath(root))
    return real === r || real.startsWith(r + sep)
  })
}

/** Default readable roots for agent assets (Codex plugins, tmp, …). */
export function getReadableAssetRoots(
  projectRoots: string[],
  opts?: { homeDir?: string; tmpDir?: string },
): string[] {
  const homeDir = opts?.homeDir ?? homedir()
  const tmpDirs = [opts?.tmpDir ?? process.env.TMPDIR, '/tmp', '/private/tmp'].filter(Boolean) as string[]
  const extraRoots = [
    join(homeDir, '.codex', '.tmp', 'plugins'),
    join(homeDir, '.codex', '.tmp', 'bundled-marketplaces'),
    join(homeDir, '.cache', 'codex-runtimes'),
  ]
  return Array.from(new Set([...projectRoots, ...tmpDirs, ...extraRoots]))
}
