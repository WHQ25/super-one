import { execFile } from 'child_process'
import log from './logger'
import { sanitizePathEnv } from './spawn-env'

const PATH_OUTPUT_START = '__SUPERONE_PATH_OUTPUT_START__'
const PATH_OUTPUT_END = '__SUPERONE_PATH_OUTPUT_END__'

function extractPath(output: string): string {
  const start = output.lastIndexOf(PATH_OUTPUT_START)
  if (start < 0) throw new Error('PATH start marker missing')
  const valueStart = start + PATH_OUTPUT_START.length
  const end = output.indexOf(PATH_OUTPUT_END, valueStart)
  if (end < 0) throw new Error('PATH end marker missing')
  return output.slice(valueStart, end)
}

let shellPath: Promise<void> | null = null
let shellPathReady = false

/**
 * Adopt the login shell's PATH once. Finder/Dock launches inherit launchd's
 * minimal PATH, so bare commands — and agent CLIs' own tools — would miss
 * Homebrew, nvm, etc. A heavy rc takes seconds, so this runs off the main
 * thread and startup does not wait for it; anything that spawns awaits it.
 */
export function ensureShellPath(): Promise<void> {
  shellPath ??= startRead()
  return shellPath
}

/** Re-read after an installer may have edited the shell profile. */
export function refreshShellPath(): Promise<void> {
  shellPath = startRead()
  return shellPath
}

/** Wraps an async spawner so it only runs on the login-shell PATH. */
export function withShellPath<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return async (...args) => {
    await ensureShellPath()
    return fn(...args)
  }
}

/** For sync callers that must keep their ordering once the PATH is settled. */
export function isShellPathReady(): boolean {
  return shellPathReady
}

function startRead(): Promise<void> {
  shellPathReady = false
  const read = readLoginShellPath().then(() => {
    if (shellPath === read) shellPathReady = true
  })
  return read
}

function readLoginShellPath(): Promise<void> {
  if (process.platform === 'win32') return Promise.resolve()
  const shell = process.env.SHELL || '/bin/sh'
  return new Promise((resolve) => {
    const child = execFile(
      shell,
      ['-ilc', `printf '${PATH_OUTPUT_START}%s${PATH_OUTPUT_END}' "$PATH"`],
      { timeout: 5000 },
      (error, stdout) => {
        try {
          if (error) throw error
          const loginPath = extractPath(stdout)
          if (loginPath) {
            const { value: cleanPath, dropped, deduped } = sanitizePathEnv(loginPath)
            process.env.PATH = cleanPath
            log.info('[fixPath] PATH updated via %s bytes=%d (deduped %d, dropped %d over-long)', shell, cleanPath.length, deduped, dropped)
            if (cleanPath.length > 32768) {
              log.warn('[fixPath] PATH still %dB after sanitize — very long, command resolution may be slow', cleanPath.length)
            }
          }
        } catch {
          log.warn('[fixPath] Failed to get PATH from login shell')
        }
        resolve()
      },
    )
    // rc scripts that read stdin would otherwise wait out the timeout.
    child.stdin?.end()
  })
}
