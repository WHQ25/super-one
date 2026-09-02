import { existsSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

/**
 * A cwd inside the project's own checkout is not a separate worktree — it is
 * served by the project's `.git` and has none of its own. `relative()` returning
 * `''` (cwd *is* the project root) counts as inside.
 */
function isInsideProject(projectPath: string, target: string): boolean {
  const rel = relative(resolve(projectPath), resolve(target))
  return !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Is `worktreePath` still a working directory this session can run in?
 *
 * Plain directory existence is not the answer. `git worktree remove` unregisters
 * the worktree but routinely leaves the directory behind: one untracked,
 * gitignored entry is enough to defeat the removal, and a harness process still
 * running in the old cwd can recreate one right after it (`.claude/.cc-writes`
 * is the observed case). `existsSync` then reports the worktree as live, the
 * session keeps a cwd with no repo and no code, and every tool call fails with a
 * confusing "file not found" instead of the session going read-only.
 *
 * The repo link is the honest signal: a separate worktree always carries a
 * `.git` *file* holding `gitdir: <repo>/.git/worktrees/<name>`, and
 * `git worktree remove` deletes it. Only paths outside the project checkout are
 * held to that test — sessions recorded with a `worktreePath` inside the project
 * (a collaboration child attached to a subdirectory, see `session-collaboration`)
 * legitimately have no `.git` of their own.
 *
 * Known gap, deliberately left: residue of a worktree that lived *inside* the
 * project still reads as alive. SuperOne cuts worktrees under `~/.worktrees`, so
 * this only reaches a hand-made one, and it degrades gently — the cwd is still
 * within the project's checkout, so git resolves and tools keep working. Closing
 * it would need `git worktree list`, a subprocess on a synchronous resume path.
 */
export function worktreeExists(worktreePath: string, projectPath: string): boolean {
  if (!worktreePath) return false
  if (!existsSync(worktreePath)) return false
  if (isInsideProject(projectPath, worktreePath)) return true
  return existsSync(join(worktreePath, '.git'))
}
