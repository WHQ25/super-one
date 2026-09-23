/**
 * Where a collaboration child runs (cwd) and which sidebar project it joins.
 */

import { existsSync, realpathSync, statSync } from 'fs'
import { homedir } from 'os'
import { resolve, sep } from 'path'
import type { SessionAgentLaunchConfig } from '@superone/shared/agent-types'
import { resolveMainWorktreeDir } from '../git/worktree-ops'
import { addRecentFolder, getRecentFolders } from '../recent-folders'
import type { Session } from './types'

/**
 * Default launch cwd. Prefer parent.cwd when it still lives under the opened
 * project; if the parent is sitting in a SuperOne worktree (or any path outside
 * the project root), fall back to projectPath so attribution does not key off
 * `~/.worktrees/…`.
 */
export function defaultLaunchCwd(parent: Session): string {
  const project = resolve(parent.projectPath)
  const cwd = resolve(parent.cwd)
  if (isWithin(project, cwd)) return parent.cwd
  return parent.projectPath
}

export function resolveCwd(config: SessionAgentLaunchConfig, parent: Session): string {
  const cwd = resolve(config.cwd || defaultLaunchCwd(parent))
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) throw new Error(`Working directory does not exist: ${cwd}`)
  return cwd
}

/** Resolve + realpath so symlink /var vs /private/var forms compare equal. */
function canonicalPath(input: string): string {
  const abs = resolve(input)
  try {
    return realpathSync(abs)
  } catch {
    return abs
  }
}

function isWithin(root: string, target: string): boolean {
  const normalizedRoot = canonicalPath(root)
  const normalizedTarget = canonicalPath(target)
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(normalizedRoot + sep)
}

/** SuperOne places collab/agent worktrees under `~/.worktrees/<repo>/…`. */
export function isManagedWorktreePath(dir: string): boolean {
  const managedRoot = resolve(homedir(), '.worktrees')
  return isWithin(managedRoot, dir)
}

/**
 * Decide which sidebar project a collab child should join.
 *
 * Product rules:
 * 1. Agents MAY open a genuinely different directory as its own project
 *    (another repo / scratch folder) — that is intentional cross-project work.
 * 2. Different worktrees of the *same* git repo must share one project row.
 *    Never promote `~/.worktrees/<repo>/<epoch>-<hash>` (or any git worktree
 *    leaf) to a sidebar project; file under the main checkout instead.
 *
 * Call with the *requested* cwd, before worktree activation — a freshly cut
 * worktree lives outside every project root but belongs to the repo it was
 * cut from.
 */
export async function ensureChildProject(cwd: string, parentProjectPath: string): Promise<string> {
  const cwdCanon = canonicalPath(cwd)
  let mainDir: string | null = null
  try {
    const resolved = canonicalPath(await resolveMainWorktreeDir(cwd))
    // Only treat as a worktree-of-something when git points elsewhere.
    if (resolved !== cwdCanon) mainDir = resolved
  } catch {
    // Not a git repo / unreadable — path-prefix ownership is enough.
  }

  const candidates = mainDir ? [cwdCanon, mainDir] : [cwdCanon]

  let owner: string | null = null
  let ownerDepth = -1
  const consider = (projectPath: string, candidate: string) => {
    if (!isWithin(projectPath, candidate)) return
    const depth = canonicalPath(projectPath).length
    if (depth > ownerDepth) {
      owner = projectPath
      ownerDepth = depth
    }
  }
  for (const candidate of candidates) {
    consider(parentProjectPath, candidate)
    for (const project of getRecentFolders()) {
      if (project.missing) continue
      consider(project.path, candidate)
    }
  }
  if (owner) return owner

  // Cwd is a worktree leaf of a repo the user has not opened yet — open the
  // main checkout as the project, never the worktree directory itself.
  if (mainDir) {
    addRecentFolder(mainDir)
    return mainDir
  }

  // Managed SuperOne worktree path but main-dir lookup failed (stale/removed):
  // do not invent a `tjdllgg-…` project; keep the parent.
  if (isManagedWorktreePath(cwd)) return parentProjectPath

  // Genuinely new directory (other project / scratch). Agents are allowed to
  // spawn work in a separate project this way.
  addRecentFolder(cwd)
  return cwd
}
