import { execFileSync } from 'child_process'
import { realpathSync } from 'fs'
import { resolve } from 'path'

function normalizePath(inputPath: string): string {
  const absPath = resolve(inputPath)
  try {
    return realpathSync(absPath)
  } catch {
    return absPath
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
