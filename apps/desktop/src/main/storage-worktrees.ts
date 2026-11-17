/**
 * Disk use of SuperOne-created worktrees (`~/.worktrees/<repo>/<name>`) and
 * removal of the ones nothing points at any more. Async throughout: a
 * worktree with installed dependencies holds hundreds of thousands of files.
 * See docs/features/worktree-space.md.
 */

import { lstat, readdir, rmdir } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { removeWorktree, type WorktreeGit } from '@superone/runtime/git'
import type { StorageWorktree, StorageWorktreeRemoval } from '@superone/shared/desktop-storage'

export interface WorktreeStorageContext {
  /** The managed root, `~/.worktrees`. */
  root: string
  git: WorktreeGit
  /** Paths sessions and projects still point at; read again before every removal. */
  referencedPaths: () => string[]
}

function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

async function childDirectories(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => join(dir, entry.name)).sort()
  } catch {
    return []
  }
}

/** Bytes of regular files under `root`. Links are not followed, so shared directories count as nothing. */
export async function directoryBytes(root: string): Promise<number> {
  let total = 0
  const pending = [root]
  while (pending.length > 0) {
    const dir = pending.pop()!
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    const files: string[] = []
    for (const entry of entries) {
      if (entry.isDirectory()) pending.push(join(dir, entry.name))
      else if (entry.isFile()) files.push(join(dir, entry.name))
    }
    const sizes = await Promise.all(files.map((file) => lstat(file).then((stat) => stat.size, () => 0)))
    for (const size of sizes) total += size
  }
  return total
}

function isReferenced(worktree: string, referenced: string[]): boolean {
  return referenced.some((path) => path === worktree || path.startsWith(worktree + sep))
}

export async function listManagedWorktrees(ctx: WorktreeStorageContext): Promise<StorageWorktree[]> {
  const referenced = ctx.referencedPaths().map(canonical)
  const worktrees: StorageWorktree[] = []
  for (const repoDir of await childDirectories(ctx.root)) {
    for (const path of await childDirectories(repoDir)) {
      const [bytes, branch, status] = await Promise.all([
        directoryBytes(path),
        ctx.git.read(path, ['symbolic-ref', '--short', '-q', 'HEAD']).then((out) => out.trim() || null, () => null),
        ctx.git.read(path, ['status', '--porcelain']).catch(() => ''),
      ])
      worktrees.push({
        path,
        repo: repoDir.slice(ctx.root.length + 1),
        branch,
        bytes,
        inUse: isReferenced(canonical(path), referenced),
        dirty: status.trim().length > 0,
      })
    }
  }
  return worktrees
}

/** Remove worktrees that sit directly under a repo directory of the managed root and are still unreferenced. */
export async function removeUnusedWorktrees(ctx: WorktreeStorageContext, paths: string[]): Promise<StorageWorktreeRemoval> {
  const root = canonical(ctx.root)
  const result: StorageWorktreeRemoval = { removed: [], failed: [] }
  for (const path of paths) {
    try {
      const target = canonical(path)
      if (dirname(dirname(target)) !== root) throw new Error('Not a SuperOne worktree')
      if (!(await lstat(target)).isDirectory()) throw new Error('Not a directory')
      // Read again: a session may have adopted the worktree since it was listed.
      if (isReferenced(target, ctx.referencedPaths().map(canonical))) throw new Error('Worktree is in use')
      await removeWorktree(ctx.git, target)
      await rmdir(dirname(target)).catch(() => {
        /* other worktrees of the repository remain */
      })
      result.removed.push(path)
    } catch (err) {
      result.failed.push({ path, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return result
}
