/**
 * `git clone` execution for the add-project flow.
 *
 * Node-only module (imports `node:child_process`) — imported by the desktop
 * main process and the CLI node, never by the renderer. Both hosts must behave
 * identically, so the destination resolution and the git invocation live here
 * rather than being written twice.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { repoNameFromGitUrl, validateCloneRemoteUrl } from './git-remote'

/** A clone of a large repo over a slow link still has to finish. */
const CLONE_TIMEOUT_MS = 15 * 60 * 1000
/** Enough stderr to explain a failure; progress output would otherwise grow unbounded. */
const STDERR_TAIL_CHARS = 16 * 1024

/** Only the object download is slow enough to be worth a bar; other phases are quick. */
const RECEIVING_LINE = /^Receiving objects:\s+(\d{1,3})%/
/** Any progress meter, including `remote:` phases — kept out of error messages. */
const ANY_PROGRESS_LINE = /:\s+\d{1,3}%/

/** Download percent for one `git clone --progress` stderr line, or null for other lines. */
export function parseCloneProgress(line: string): number | null {
  const match = RECEIVING_LINE.exec(line.trim())
  return match ? Math.min(Number(match[1]), 100) : null
}

export interface CloneRepositoryInput {
  remoteUrl: string
  /** Absolute directory the repository folder is created in. */
  parentPath: string
  /** Folder name to create; defaults to the repo name derived from the URL. */
  directoryName?: string
  /**
   * When true, pass `--depth=1` so only the tip commit is fetched.
   * Omitted / false keeps a full clone (older clients and explicit opt-out).
   */
  shallow?: boolean
}

/** `git clone` argv after the binary name. Exported so tests can lock the flag order. */
export function buildCloneArgs(input: CloneRepositoryInput, destinationPath: string): string[] {
  // Progress is only written to a TTY unless asked for explicitly.
  const args = ['clone', '--progress']
  if (input.shallow) args.push('--depth=1')
  // `--` stops git from reading a hostile URL as an option.
  args.push('--', input.remoteUrl.trim(), destinationPath)
  return args
}

export interface CloneRepositoryResult {
  /** Absolute path of the cloned working tree. */
  path: string
  name: string
}

function invalid(message: string): Error {
  return Object.assign(new Error(message), { code: 'invalid_argument' })
}

/**
 * Resolve the absolute destination without touching the filesystem. Exported so
 * the renderer's preview and the actual clone can never drift apart.
 */
export function resolveCloneDestination(input: CloneRepositoryInput): CloneRepositoryResult {
  const urlError = validateCloneRemoteUrl(input.remoteUrl)
  if (urlError) throw invalid(urlError)

  const parent = input.parentPath.trim()
  if (!parent) throw invalid('destination directory is required')
  if (!isAbsolute(parent)) throw invalid('destination directory must be an absolute path')

  const requested = input.directoryName?.trim()
  const name = requested || repoNameFromGitUrl(input.remoteUrl)
  if (!name) throw invalid('cannot determine a folder name for this repository')
  if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
    throw invalid(`invalid folder name: ${name}`)
  }

  return { path: join(resolve(parent), name), name }
}

/**
 * Clone into `<parentPath>/<directoryName>`, creating the parent directory when
 * it does not exist yet (the "Create & Clone" case in the add-project dialog).
 * `onProgress` receives the monotonically increasing object download percent.
 */
export async function cloneRepository(
  input: CloneRepositoryInput,
  onProgress?: (percent: number) => void,
): Promise<CloneRepositoryResult> {
  const destination = resolveCloneDestination(input)

  if (existsSync(destination.path)) {
    throw Object.assign(new Error(`destination already exists: ${destination.path}`), {
      code: 'conflict',
    })
  }

  const parent = resolve(input.parentPath.trim())
  mkdirSync(parent, { recursive: true })

  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn('git', buildCloneArgs(input, destination.path), {
      cwd: parent,
      timeout: CLONE_TIMEOUT_MS,
      stdio: ['ignore', 'ignore', 'pipe'],
      // Never let git block on an interactive credential or host-key prompt:
      // a hung prompt would leave the dialog spinning with no way out.
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: 'echo',
        GIT_SSH_COMMAND: `${process.env.GIT_SSH_COMMAND ?? 'ssh'} -o BatchMode=yes`,
      },
    })

    let stderrTail = ''
    let pending = ''
    let lastPercent = -1
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_CHARS)
      if (!onProgress) return
      // Progress lines are rewritten in place with `\r`.
      const lines = (pending + chunk).split(/\r|\n/)
      pending = lines.pop() ?? ''
      for (const line of lines) {
        const percent = parseCloneProgress(line)
        if (percent !== null && percent > lastPercent) {
          lastPercent = percent
          onProgress(percent)
        }
      }
    })

    child.on('error', (err) => {
      reject(Object.assign(err, { code: 'failed_precondition' }))
    })
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      const detail = stderrTail
        .split(/\r|\n/)
        .filter((line) => line.trim() && !ANY_PROGRESS_LINE.test(line))
        .slice(-4)
        .join('\n')
        .trim()
      const fallback = signal
        ? `git clone was terminated (${signal}): ${input.remoteUrl}`
        : `git clone failed: ${input.remoteUrl}`
      reject(Object.assign(new Error(detail || fallback), { code: 'failed_precondition' }))
    })
  })

  return destination
}
