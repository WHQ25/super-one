import { execFile } from 'child_process'
import { buildSafeEnv } from '../spawn-env'

/** `gh` output is JSON for everything we ask; a page of issues is far below this. */
const GH_MAX_BUFFER = 16 * 1024 * 1024

/** Thrown shape for a missing `gh` binary, so callers can say "install gh" rather than "failed". */
export function isGhMissingError(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/**
 * Run the GitHub CLI in a checkout. Read-only by contract: every caller lists
 * or views, and the timeout is mandatory because a `gh` waiting on the network
 * (or on a login prompt it cannot show) would otherwise hang a popup forever.
 */
export function ghRun(
  folderPath: string,
  args: string[],
  timeoutMs: number,
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'gh',
      args,
      {
        cwd: folderPath,
        env: { ...(env ? buildSafeEnv(env) : process.env), GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' },
        maxBuffer: GH_MAX_BUFFER,
        timeout: timeoutMs,
      },
      (err, stdout, stderr) => {
        if (err) {
          const annotated = err as NodeJS.ErrnoException & { stderr?: string; ghArgs?: string[] }
          if (stderr && !annotated.stderr) annotated.stderr = String(stderr)
          annotated.ghArgs = args
          reject(annotated)
        } else {
          resolve(stdout.trimEnd())
        }
      },
    )
  })
}
