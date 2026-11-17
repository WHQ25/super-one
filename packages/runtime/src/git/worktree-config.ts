/**
 * Per-repository worktree settings, read from the main checkout so every
 * worktree of a repository — whichever host creates it — follows one file.
 * See docs/features/worktree-space.md.
 */

import { readFileSync } from 'node:fs'
import { isAbsolute, join, posix } from 'node:path'

export const WORKTREE_CONFIG_FILE = join('.superone', 'worktree.json')

export interface WorktreeConfig {
  /** Directories to check out (cone-mode sparse checkout); empty checks out everything. */
  sparsePaths: string[]
  /** Git-ignored paths linked from the main checkout instead of being recreated. */
  sharedPaths: string[]
}

const EMPTY: WorktreeConfig = { sparsePaths: [], sharedPaths: [] }

/** A repo-relative POSIX path that stays inside the checkout and outside `.git`; null otherwise. */
export function normalizeRepoRelativePath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim().replace(/\\/g, '/')
  if (!raw || isAbsolute(raw) || /^[A-Za-z]:/.test(raw) || raw.includes('\0')) return null
  const normalized = posix.normalize(raw).replace(/\/+$/, '')
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) return null
  if (normalized.split('/')[0] === '.git') return null
  return normalized
}

function pathList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const paths = value.map(normalizeRepoRelativePath).filter((path): path is string => path !== null)
  return [...new Set(paths)]
}

/** Missing or malformed settings mean a plain full checkout, never a failed creation. */
export function readWorktreeConfig(mainDir: string): WorktreeConfig {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(join(mainDir, WORKTREE_CONFIG_FILE), 'utf8'))
  } catch {
    return EMPTY
  }
  if (!parsed || typeof parsed !== 'object') return EMPTY
  const record = parsed as Record<string, unknown>
  return { sparsePaths: pathList(record.sparsePaths), sharedPaths: pathList(record.sharedPaths) }
}
