import { readFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import type { WorktreeInfo } from '@superone/shared/agent-types'
import type { GitMentionCapabilities } from '@superone/shared/git-mention-query'
import { createKeyedGitReadCache } from './keyed-git-read-cache'

/**
 * The worktree list expires because add/remove is not always visible to the
 * watcher (it follows one folder, and a linked worktree does not see the main
 * checkout's `.git/worktrees`). `@git` capabilities stay until a mutation or
 * the watcher drops them. A failed probe is not stored. A switch inside the
 * window still reuses the list.
 */
const LOCAL_WORKTREE_TTL_MS = 30_000
const reads = createKeyedGitReadCache<WorktreeInfo | null, GitMentionCapabilities>({
  worktreeTtlMs: LOCAL_WORKTREE_TTL_MS,
  mentionTtlMs: Number.POSITIVE_INFINITY,
  unstableMention: (value) => value.repo === 'unsupported',
})

export function cachedLocalWorktreeInfo(
  folderPath: string,
  compute: () => Promise<WorktreeInfo | null>,
): Promise<WorktreeInfo | null> {
  return reads.worktree(folderPath, compute)
}

export function cachedLocalGitMentionCapabilities(
  folderPath: string,
  compute: () => Promise<GitMentionCapabilities>,
): Promise<GitMentionCapabilities> {
  return reads.mention(folderPath, compute)
}

/** Drop cached local worktree and mention reads for one folder, or every folder. */
export function invalidateLocalGitReads(folderPath?: string): void {
  reads.invalidate(folderPath)
}

/**
 * Main checkout of a linked worktree, from its `.git` gitdir file
 * (`<main>/.git/worktrees/<name>`). Null when this folder is not one.
 * Sync and local: the file watcher uses it to drop the main checkout's cache
 * key without spawning git.
 */
export function mainCheckoutOfLinkedWorktree(folderPath: string): string | null {
  let text: string
  try {
    text = readFileSync(join(folderPath, '.git'), 'utf8')
  } catch {
    return null
  }
  const match = /^gitdir:\s*(.+)\s*$/m.exec(text)
  const spec = match?.[1]
  if (!spec) return null
  const gitDir = isAbsolute(spec) ? spec : resolve(folderPath, spec)
  if (basename(dirname(gitDir)) !== 'worktrees') return null
  const gitMeta = dirname(dirname(gitDir))
  if (basename(gitMeta) !== '.git') return null
  const main = dirname(gitMeta)
  if (!main || main === folderPath) return null
  return main
}
