import { execFileSync } from 'child_process'
import { realpathSync, statSync } from 'fs'
import { dirname, join, resolve } from 'path'

function normalizePath(inputPath: string): string {
  const absPath = resolve(inputPath)
  try {
    return realpathSync(absPath)
  } catch {
    return absPath
  }
}

/** Whether two paths name the same directory once symlinks (macOS `/var` → `/private/var`) resolve. */
export function isSameDirectory(a: string, b: string): boolean {
  return a === b || normalizePath(a) === normalizePath(b)
}

/**
 * The checkout a directory lies in: the project itself, or the linked worktree whose
 * root holds a `.git` file. Null when it is in neither, such as a directory outside
 * the project that a shell `cd` reached.
 */
export function checkoutRoot(dir: string, projectPath: string): string | null {
  for (let current = resolve(dir); ; current = dirname(current)) {
    if (isSameDirectory(current, projectPath)) return projectPath
    try {
      if (statSync(join(current, '.git')).isFile()) return current
    } catch { /* no `.git` here */ }
    if (dirname(current) === current) return null
  }
}

/**
 * Resolve a project path for session scoping.
 * Git repositories are normalized to their worktree root (`--show-toplevel`).
 * Non-git folders fall back to the normalized absolute path.
 */
export function resolveProjectPath(inputPath: string): string {
  const normalized = normalizePath(inputPath)

  try {
    const topLevel = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: normalized,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      // Synchronous on the main thread — cap it so a stuck git cannot freeze the app.
      timeout: 5000,
    }).trim()
    return normalizePath(topLevel)
  } catch {
    return normalized
  }
}
