/**
 * `git clone` execution for the add-project flow.
 *
 * Node-only module (imports `node:child_process`) — imported by the desktop
 * main process and the CLI node, never by the renderer. Both hosts must behave
 * identically, so the destination resolution and the git invocation live here
 * rather than being written twice.
 */

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { repoNameFromGitUrl, validateCloneRemoteUrl } from './git-remote'

/** A clone of a large repo over a slow link still has to finish. */
const CLONE_TIMEOUT_MS = 15 * 60 * 1000

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
  const args = ['clone']
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
 */
export async function cloneRepository(
  input: CloneRepositoryInput,
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
    execFile(
      'git',
      buildCloneArgs(input, destination.path),
      {
        cwd: parent,
        timeout: CLONE_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        // Never let git block on an interactive credential or host-key prompt:
        // a hung prompt would leave the dialog spinning with no way out.
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_ASKPASS: 'echo',
          GIT_SSH_COMMAND: `${process.env.GIT_SSH_COMMAND ?? 'ssh'} -o BatchMode=yes`,
        },
      },
      (err, _stdout, stderr) => {
        if (!err) {
          resolvePromise()
          return
        }
        const detail = (stderr || err.message || '').trim().split('\n').slice(-4).join('\n')
        reject(
          Object.assign(new Error(detail || `git clone failed: ${input.remoteUrl}`), {
            code: 'failed_precondition',
          }),
        )
      },
    )
  })

  return destination
}
