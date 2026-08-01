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
