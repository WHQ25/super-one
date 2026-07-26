import { execFile } from 'child_process'
import { buildSafeEnv } from './spawn-env'

/**
 * `execFile` defaults to a 1 MB stdout buffer and SIGTERMs the child once it is
 * exceeded — a silent failure for `diff`/`log`/`status` in a large repo.
 */
const GIT_MAX_BUFFER = 64 * 1024 * 1024

/**
 * Suppress git's *optional* index refresh. Required locks (commit, checkout,
 * stash, worktree add) are unaffected — this only stops read commands from
 * rewriting `.git/index`, which they otherwise do on almost every call.
 *
 * SuperOne runs `git status` constantly: a 5s status-bar poll per session
 * window, plus fs-watch-driven source-control and file-tree refreshes. Every
 * one of those took `.git/index.lock` to persist a refreshed stat cache, which
 * (a) collided with the agent's own `git add` / `git commit`
 *     ("fatal: Unable to create '.git/index.lock': File exists"),
 * (b) left the lock behind whenever such a git was killed without cleanup, and
 * (c) fed the file watcher's `.git/index` rule, whose FILE_CHANGE_EVENT drove
 *     yet another refresh → another `git status` → another index write.
 */
const NO_OPTIONAL_LOCKS = '--no-optional-locks'

export interface GitRunOptions {
  /**
   * Kill git after this many ms and reject. Off by default: mutating commands
   * (`checkout`, `worktree add`, `stash`) must never be half-killed. Set it on
   * read-only calls that feed polling UI, where an un-timed-out git means the
   * caller's promise never settles and the UI stays blank forever.
   */
  timeoutMs?: number
}

export function gitRun(
  folderPath: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
  opts?: GitRunOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      [NO_OPTIONAL_LOCKS, ...args],
      {
        cwd: folderPath,
        env: env ? buildSafeEnv(env) : undefined,
        maxBuffer: GIT_MAX_BUFFER,
        ...(opts?.timeoutMs ? { timeout: opts.timeoutMs } : {}),
      },
      (err, stdout, stderr) => {
        if (err) {
          // execFile does not attach stdout/stderr to the error in callback
          // form, so `gitErrorMessage` (and the logs) would otherwise only ever
          // see "Command failed: …". Annotate with what actually went wrong.
          const annotated = err as NodeJS.ErrnoException & {
            stderr?: string
            gitArgs?: string[]
            gitTimedOut?: boolean
          }
          if (stderr && !annotated.stderr) annotated.stderr = String(stderr)
          annotated.gitArgs = args
          if (opts?.timeoutMs && (err as { killed?: boolean }).killed) {
            annotated.gitTimedOut = true
            annotated.message = `git ${args.join(' ')} timed out after ${opts.timeoutMs}ms in ${folderPath}`
          }
          reject(annotated)
        } else {
          resolve(stdout.trimEnd())
        }
      },
    )
  })
}
