import log from './logger'

/**
 * Diagnostics for the git status bar.
 *
 * Every git-backed IPC handler swallows its errors and returns `null` / `[]`,
 * because a non-repo folder is a normal state. The cost is that a repo-specific
 * git failure (dubious ownership, a hanging `core.fsmonitor`, a corrupt `.git`,
 * a cold `status` on a huge worktree) is indistinguishable from "not a repo" —
 * the branch chip just never renders and nothing reaches main.log.
 *
 * These helpers make that state observable. The status bar polls every 5s per
 * project, so warns are throttled per (scope, folder) to keep main.log usable.
 */

const THROTTLE_MS = 60_000
const lastLoggedAt = new Map<string, number>()

function shouldLog(key: string): boolean {
  const now = Date.now()
  const prev = lastLoggedAt.get(key)
  if (prev !== undefined && now - prev < THROTTLE_MS) return false
  lastLoggedAt.set(key, now)
  return true
}

interface GitExecError {
  code?: string | number
  signal?: string
  killed?: boolean
  stderr?: string
  message?: string
  gitArgs?: string[]
  gitTimedOut?: boolean
}

/** Flatten an execFile rejection into a single log-friendly line. */
export function describeGitError(err: unknown): string {
  const e = err as GitExecError | null
  if (!e) return String(err)
  const parts: string[] = []
  if (e.gitArgs) parts.push(`args="git ${e.gitArgs.join(' ')}"`)
  if (e.gitTimedOut) parts.push('timedOut=true')
  if (e.code !== undefined) parts.push(`code=${e.code}`)
  if (e.signal) parts.push(`signal=${e.signal}`)
  const stderr = e.stderr?.trim()
  if (stderr) parts.push(`stderr=${JSON.stringify(stderr.slice(0, 400))}`)
  else if (e.message) parts.push(`message=${JSON.stringify(e.message.slice(0, 400))}`)
  return parts.length > 0 ? parts.join(' ') : String(err)
}

/**
 * A git read failed and the caller is about to return a "no git info" value.
 * `hasDotGit` distinguishes the benign case (plain folder) from the one that
 * silently blanks the status bar (folder *is* a repo, but git refuses it).
 */
export function logGitFailure(scope: string, folderPath: string, err: unknown, hasDotGit?: boolean): void {
  if (!shouldLog(`${scope}|${folderPath}`)) return
  const repoHint = hasDotGit ? ' (.git exists — status bar will render nothing)' : ''
  log.warn('[git.%s] failed for %s%s: %s', scope, folderPath, repoHint, describeGitError(err))
}

/** A git read succeeded but took long enough to stall the polling status bar. */
export function logSlowGit(scope: string, folderPath: string, ms: number, detail?: string): void {
  if (!shouldLog(`${scope}.slow|${folderPath}`)) return
  log.warn('[git.%s] slow for %s: %dms%s', scope, folderPath, Math.round(ms), detail ? ` ${detail}` : '')
}
