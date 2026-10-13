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

export function withRepoLock<T>(repoKey: string, task: () => Promise<T>): Promise<T> {
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
