/**
 * Worktree activation, handoff and branch assignment by path. Every host (the
 * desktop window, the runtime `WorkspaceGitService` serving remote clients)
 * runs these, so repo-mutating flows on one repository queue on one
 * {@link withRepoLock} per process.
 */

import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { WorktreeMode } from '@superone/shared/agent-types'
import { gitRun, type GitRunOptions } from './run'
import { gitErrorMessage, sanitizeGitRef } from './sanitize-ref'
import { withRepoLock } from './repo-lock'
import {
  allocateWorktreePath,
  checkedOutBranchesFromPorcelain,
  parseNumstat,
  planNewWorktreePaths,
  recordedBranchForMode,
  resolveMainDirFromCommonDir,
  worktreeAddArgs,
} from './worktree-plan'

/**
 * Reads feed status bars, pickers, previews and path checks: a git stuck on a
 * lock or a slow filesystem fails them instead of leaving the request pending
 * forever. Mutations stay untimed so they are never half-killed.
 */
export const GIT_READ_OPTS: GitRunOptions = { timeoutMs: 20_000 }

export interface WorktreeGit {
  /** Read-only git, killed after {@link GIT_READ_OPTS}. */
  read(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string>
  /** Mutating git; never timed out. */
  write(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string>
}

/** Read/write runners over a host's git process runner (e.g. on its login-shell PATH). */
export function worktreeGit(run: typeof gitRun = gitRun): WorktreeGit {
  return {
    read: (cwd, args, env) => run(cwd, args, env, GIT_READ_OPTS),
    write: (cwd, args, env) => run(cwd, args, env),
  }
}

export interface ActivateWorktreeInput {
  baseBranch: string
  mode: WorktreeMode
  branchName?: string
  carryLocalChanges?: boolean
}

export interface ActivateWorktreeResult {
  path: string
  recordedBranch: string | null
}

export type AssignBranchResult =
  | { ok: true; branch: string }
  | {
      ok: false
      reason: 'name-required' | 'not-detached' | 'exists' | 'checked-out' | 'error'
      error?: string
    }

export type HandoffResult =
  | { ok: true }
  | {
      ok: false
      reason: 'not-worktree' | 'no-changes' | 'main-dirty' | 'conflict' | 'error'
      error?: string
    }

export interface HandoffPreview {
  files: number
  insertions: number
  deletions: number
}

export function samePath(a: string, b: string): boolean {
  try {
    const ra = existsSync(a) ? realpathSync(a) : resolve(a)
    const rb = existsSync(b) ? realpathSync(b) : resolve(b)
    return ra === rb
  } catch {
    return resolve(a) === resolve(b)
  }
}

export async function resolveMainWorktreeDir(git: WorktreeGit, folderPath: string): Promise<string> {
  const common = await git.read(folderPath, ['rev-parse', '--git-common-dir'])
  return resolveMainDirFromCommonDir(folderPath, common)
}

async function isOnBranch(git: WorktreeGit, cwd: string): Promise<boolean> {
  try {
    await git.read(cwd, ['symbolic-ref', '-q', 'HEAD'])
    return true
  } catch {
    return false
  }
}

/** Copy the source's uncommitted changes into a freshly created worktree. */
export async function carryUncommittedChanges(
  git: WorktreeGit,
  sourceDir: string,
  worktreePath: string,
): Promise<void> {
  const stashTop = () =>
    git.read(sourceDir, ['rev-parse', '-q', '--verify', 'refs/stash']).then((s) => s.trim(), () => '')
  const before = await stashTop()
  await git.write(sourceDir, ['stash', 'push', '-u', '-m', 'superone-carry']).catch(() => {
    /* nothing to stash */
  })
  const after = await stashTop()
  if (!after || after === before) return
  await git.write(worktreePath, ['stash', 'apply', after]).catch(() => {
    /* ignore rare apply miss */
  })
  await git.write(sourceDir, ['stash', 'pop']).catch(() => {
    /* changes stay in stash */
  })
}

/** Create a worktree of `folderPath`'s repository; refs must already be sanitized. */
export async function activateWorktree(
  git: WorktreeGit,
  folderPath: string,
  input: ActivateWorktreeInput,
): Promise<ActivateWorktreeResult> {
  const { baseBranch, mode, branchName, carryLocalChanges } = input
  const mainDir = await resolveMainWorktreeDir(git, folderPath)

  // `worktree add` and the carry stash take repo-wide locks, two carries
  // interleaving pop each other's (or the user's) stash, and the
  // second-resolution path stamp collides — queue per repo.
  return withRepoLock(mainDir, async () => {
    const commitHash = (await git.read(folderPath, ['rev-parse', baseBranch])).trim()
    const planned = planNewWorktreePaths({ mainDir, shortHash: commitHash.slice(0, 7) })
    if (!existsSync(planned.wtDir)) mkdirSync(planned.wtDir, { recursive: true })
    const wtPath = allocateWorktreePath(planned.wtDir, basename(planned.wtPath))
    await git.write(folderPath, ['worktree', ...worktreeAddArgs(mode, wtPath, baseBranch, branchName)])
    if (carryLocalChanges) await carryUncommittedChanges(git, folderPath, wtPath)
    return { path: wtPath, recordedBranch: recordedBranchForMode(mode, baseBranch, branchName) }
  })
}

/** Roll back only a fresh, unused checkout; no agent turn has been admitted yet. */
export async function rollbackUnusedWorktree(git: WorktreeGit, sourceDir: string, worktreePath: string, input: ActivateWorktreeInput): Promise<void> {
  const mainDir = await resolveMainWorktreeDir(git, sourceDir)
  await withRepoLock(mainDir, async () => {
    await git.write(sourceDir, ['worktree', 'remove', '--force', worktreePath])
    if (input.mode === 'branch' && input.branchName) await git.write(sourceDir, ['branch', '-D', sanitizeGitRef(input.branchName)])
  })
}

/**
 * Snapshot the worktree's working tree (tracked and untracked) as a tree
 * object. Only a temporary index is written, so it runs as a timed read: a
 * killed run leaves the repository as it was.
 */
async function writeWorkingTree(git: WorktreeGit, worktreePath: string): Promise<string> {
  const tmpIndex = join(tmpdir(), `s1-handoff-${randomUUID()}.index`)
  const env = { GIT_INDEX_FILE: tmpIndex }
  try {
    await git.read(worktreePath, ['read-tree', 'HEAD'], env)
    await git.read(worktreePath, ['add', '-A'], env)
    return (await git.read(worktreePath, ['write-tree'], env)).trim()
  } finally {
    rmSync(tmpIndex, { force: true })
  }
}

type HandoffDiff =
  | { ok: true; mainDir: string; base: string; tree: string; stat: HandoffPreview }
  | { ok: false; reason: 'not-worktree' | 'no-changes' }

async function buildHandoffDiff(git: WorktreeGit, worktreePath: string): Promise<HandoffDiff> {
  const mainDir = await resolveMainWorktreeDir(git, worktreePath)
  if (samePath(mainDir, worktreePath)) return { ok: false, reason: 'not-worktree' }

  const [onBranch, worktreeHead, tree] = await Promise.all([
    isOnBranch(git, worktreePath),
    git.read(worktreePath, ['rev-parse', 'HEAD']).then((s) => s.trim()),
    writeWorkingTree(git, worktreePath),
  ])

  let base = worktreeHead
  if (!onBranch) {
    const mainHead = (await git.read(mainDir, ['rev-parse', 'HEAD'])).trim()
    base =
      (await git.read(worktreePath, ['merge-base', mainHead, worktreeHead]).catch(() => worktreeHead)).trim() ||
      worktreeHead
  }

  const numstat = await git.read(worktreePath, ['diff', '--numstat', base, tree])
  if (!numstat.trim()) return { ok: false, reason: 'no-changes' }
  return { ok: true, mainDir, base, tree, stat: parseNumstat(numstat) }
}

/** What a handoff would carry; null when the path is the main checkout or unreadable. */
export async function handoffPreview(git: WorktreeGit, worktreePath: string): Promise<HandoffPreview | null> {
  try {
    const diff = await buildHandoffDiff(git, worktreePath)
    if (diff.ok) return diff.stat
    return diff.reason === 'not-worktree' ? null : { files: 0, insertions: 0, deletions: 0 }
  } catch {
    return null
  }
}

/** Apply the worktree's changes (squashed onto its fork point) to a clean main checkout. */
export async function handoffToMain(git: WorktreeGit, worktreePath: string): Promise<HandoffResult> {
  try {
    const diff = await buildHandoffDiff(git, worktreePath)
    if (!diff.ok) return { ok: false, reason: diff.reason }

    // Clean-check → apply → rollback must not interleave with another
    // mutation of main: a failed apply's reset --hard / clean -fd would wipe
    // a concurrent handoff (or a carry stash) that just landed.
    return await withRepoLock(diff.mainDir, async (): Promise<HandoffResult> => {
      if ((await git.read(diff.mainDir, ['status', '--porcelain'])).trim()) {
        return { ok: false, reason: 'main-dirty' }
      }
      const patch = await git.read(worktreePath, ['diff', '--binary', diff.base, diff.tree])
      // Narrow the TOCTOU window before mutating main; reset --hard on failure is only
      // safe if main was clean immediately before apply (not just at the first check).
      if ((await git.read(diff.mainDir, ['status', '--porcelain'])).trim()) {
        return { ok: false, reason: 'main-dirty' }
      }
      const patchFile = join(tmpdir(), `s1-handoff-${randomUUID()}.patch`)
      writeFileSync(patchFile, `${patch}\n`)
      try {
        await git.write(diff.mainDir, ['apply', '--3way', '--whitespace=nowarn', patchFile])
      } catch (err) {
        try {
          await git.write(diff.mainDir, ['reset', '--hard'])
          await git.write(diff.mainDir, ['clean', '-fd'])
        } catch {
          /* best-effort rollback */
        }
        return { ok: false, reason: 'conflict', error: gitErrorMessage(err) }
      } finally {
        rmSync(patchFile, { force: true })
      }
      await git.write(diff.mainDir, ['reset', '--quiet']).catch(() => {})
      return { ok: true }
    })
  } catch (err) {
    return { ok: false, reason: 'error', error: gitErrorMessage(err) }
  }
}

/** Name a detached worktree's HEAD as a new branch in place. */
export async function assignBranch(
  git: WorktreeGit,
  worktreePath: string,
  rawName: string,
): Promise<AssignBranchResult> {
  const name = rawName.trim()
  if (!name) return { ok: false, reason: 'name-required' }
  if (await isOnBranch(git, worktreePath)) return { ok: false, reason: 'not-detached' }

  try {
    const safe = sanitizeGitRef(name)
    const listed = await git.read(worktreePath, ['worktree', 'list', '--porcelain']).catch(() => '')
    if (checkedOutBranchesFromPorcelain(listed).includes(safe)) return { ok: false, reason: 'checked-out' }
    const exists = await git
      .read(worktreePath, ['show-ref', '--verify', '--quiet', `refs/heads/${safe}`])
      .then(() => true, () => false)
    if (exists) return { ok: false, reason: 'exists' }
    await git.write(worktreePath, ['switch', '-c', safe])
    return { ok: true, branch: safe }
  } catch (err) {
    return { ok: false, reason: 'error', error: gitErrorMessage(err) }
  }
}
