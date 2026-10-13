import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Serialize repo-mutating git operations per repository.
 *
 * `git worktree add`, `stash push/pop` and ref creation all take repository-wide
 * locks (`.git/index.lock`, `refs/stash`). Two of them running at once against
 * the same repo make one fail with "Unable to create '…index.lock': File
 * exists" — which is exactly what happens when an agent issues several
 * `session_collab_start` calls in a single parallel tool-call block.
 *
 * Callers are queued per repository key, so unrelated repos still run in
 * parallel. A failing task does not poison the queue: the next waiter runs
 * either way.
 */
const queues = new Map<string, Promise<void>>()

/**
 * One key per repository however the caller reached its path: git reports a
 * linked worktree's common dir by real path, the project root may be a symlink.
 */
function lockKey(repoPath: string): string {
  try {
    return realpathSync(repoPath)
  } catch {
    return resolve(repoPath)
  }
}

export function withRepoLock<T>(repoPath: string, task: () => Promise<T>): Promise<T> {
  const repoKey = lockKey(repoPath)
  const previous = queues.get(repoKey) ?? Promise.resolve()
  const result = previous.then(task, task)
  const tail = result.then(() => {}, () => {})
  queues.set(repoKey, tail)
  void tail.then(() => {
    // Only the current tail may clear the entry — a later waiter owns it by then.
    if (queues.get(repoKey) === tail) queues.delete(repoKey)
  })
  return result
}
