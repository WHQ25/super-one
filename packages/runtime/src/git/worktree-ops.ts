/**
 * Worktree activation, handoff and branch assignment by path. Every host (the
 * desktop window, the runtime `WorkspaceGitService` serving remote clients)
 * runs these, so repo-mutating flows on one repository queue on one
 * {@link withRepoLock} per process.
 */

import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { WorktreeMode } from '@superone/shared/agent-types'
import { gitRun, type GitRunOptions } from './run'
import { gitErrorMessage, sanitizeGitRef } from './sanitize-ref'
import { withRepoLock } from './repo-lock'
import { parseWorktreePorcelain, type WorktreePorcelainEntry } from './worktree-porcelain'
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
  /**
   * `fail` is `git worktree add -b` (the UI default). `recreate-clean` reuses
   * or rebuilds a grant-owned branch already left behind, and refuses when a
   * session still occupies that checkout.
   */
  ifExists?: 'fail' | 'recreate-clean'
  /** Called inside the repo lock. True when a session's cwd is this checkout. */
  isOccupied?: (path: string) => boolean
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
    if (input.ifExists === 'recreate-clean' && mode === 'branch' && branchName?.trim()) {
      return recreateCleanBranch(git, folderPath, mainDir, baseBranch, branchName.trim(), input.isOccupied)
    }
    const commitHash = (await git.read(folderPath, ['rev-parse', baseBranch])).trim()
    const planned = planNewWorktreePaths({ mainDir, shortHash: commitHash.slice(0, 7) })
    if (!existsSync(planned.wtDir)) mkdirSync(planned.wtDir, { recursive: true })
    const wtPath = allocateWorktreePath(planned.wtDir, basename(planned.wtPath))
    await git.write(folderPath, ['worktree', ...worktreeAddArgs(mode, wtPath, baseBranch, branchName)])
    if (carryLocalChanges) await carryUncommittedChanges(git, folderPath, wtPath)
    return { path: wtPath, recordedBranch: recordedBranchForMode(mode, baseBranch, branchName) }
  })
}

function refused(message: string): Error {
  return Object.assign(new Error(message), { code: 'failed_precondition' })
}

/**
 * A grant-owned branch may already exist from a timed-out attempt. Reuse it
 * only when it is the requested base and clean; otherwise rebuild it. Never
 * delete a checkout a session still uses, or the project's own checkout.
 */
async function recreateCleanBranch(
  git: WorktreeGit,
  folderPath: string,
  mainDir: string,
  baseBranch: string,
  branchName: string,
  isOccupied?: (path: string) => boolean,
): Promise<ActivateWorktreeResult> {
  const targetHash = (await git.read(folderPath, ['rev-parse', baseBranch])).trim()
  let branchExists = false
  try {
    await git.read(folderPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${branchName}`])
    branchExists = true
  } catch {
    branchExists = false
  }
  // List before prune. A missing `.git` file makes prune drop the registration
  // and leave the directory, which would skip the occupied check.
  const checkout = branchExists
    ? (await listWorktrees(git, folderPath)).find((entry) => entry.branch === branchName && !entry.bare)
    : undefined
  if (checkout) {
    if (samePath(checkout.path, mainDir) || samePath(checkout.path, folderPath)) {
      throw refused(`branch ${branchName} is checked out in the project`)
    }
    if (isOccupied?.(checkout.path)) throw refused(`worktree for ${branchName} is in use`)
    if (await reusableCheckout(git, checkout.path, branchName, targetHash)) {
      return { path: checkout.path, recordedBranch: branchName }
    }
    await removeCheckout(git, folderPath, checkout, mainDir)
  }
  await git.write(folderPath, ['worktree', 'prune'])
  if (!branchExists) return addBranchWorktree(git, folderPath, mainDir, baseBranch, branchName, targetHash, true)
  await git.write(folderPath, ['branch', '-f', branchName, targetHash])
  return addBranchWorktree(git, folderPath, mainDir, branchName, branchName, targetHash, false)
}

async function listWorktrees(git: WorktreeGit, folderPath: string): Promise<WorktreePorcelainEntry[]> {
  return parseWorktreePorcelain(await git.read(folderPath, ['worktree', 'list', '--porcelain']))
}

async function reusableCheckout(git: WorktreeGit, path: string, branchName: string, targetHash: string): Promise<boolean> {
  if (!existsSync(path)) return false
  // A half-written checkout (missing .git file, corrupt index) is not reusable.
  // The caller removes it and attaches again.
  try {
    const head = (await git.read(path, ['rev-parse', 'HEAD'])).trim()
    let symbolic = ''
    try {
      symbolic = (await git.read(path, ['symbolic-ref', 'HEAD'])).trim()
    } catch {
      symbolic = ''
    }
    if (head !== targetHash || symbolic !== `refs/heads/${branchName}`) return false
    return (await git.read(path, ['status', '--porcelain'])).trim().length === 0
  } catch {
    return false
  }
}

async function removeCheckout(
  git: WorktreeGit,
  folderPath: string,
  entry: WorktreePorcelainEntry,
  mainDir: string,
): Promise<void> {
  await forceRemoveWorktree(git, folderPath, entry.path, mainDir)
}

/**
 * Drop a checkout the caller has already refused as the project root or as
 * occupied. Unlock, then `remove --force`, then `remove --force --force`.
 * `rmSync` runs only for a registered worktree of this repo, or a real
 * directory that is a direct child of this repo's `~/.worktrees` folder.
 */
async function forceRemoveWorktree(git: WorktreeGit, folderPath: string, path: string, mainDir: string): Promise<void> {
  await git.write(folderPath, ['worktree', 'unlock', path]).catch(() => {})
  if (!existsSync(path)) {
    await git.write(folderPath, ['worktree', 'prune']).catch(() => {})
    return
  }
  try {
    await git.write(folderPath, ['worktree', 'remove', '--force', path])
    return
  } catch {
    /* locked, or the checkout metadata is incomplete */
  }
  try {
    await git.write(folderPath, ['worktree', 'remove', '--force', '--force', path])
    return
  } catch {
    /* Git refused the path. The directory itself may be the leftover. */
  }
  assertDeletableCheckout(path, { mainDir, folderPath, entries: await listWorktrees(git, folderPath) })
  rmSync(path, { recursive: true, force: true })
  await git.write(folderPath, ['worktree', 'prune'])
}

/** One path segment under `parent`, after resolving `.` and `..`. */
function isDirectChildPath(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel.length > 0 && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.includes(sep)
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

function realpathStaysDirectChild(parent: string, child: string): boolean {
  if (!existsSync(child)) return true
  try {
    const realParent = existsSync(parent) ? realpathSync(parent) : resolve(parent)
    return isDirectChildPath(realParent, realpathSync(child))
  } catch {
    return false
  }
}

/**
 * Git refuses `worktree remove` for a path this repo does not own, and the
 * directory fallback must not go further than Git would have. A linked
 * project checkout is not the main dir, so it is refused by `folderPath` too.
 */
function assertDeletableCheckout(
  path: string,
  scope: { mainDir: string; folderPath: string; entries: WorktreePorcelainEntry[] },
): void {
  if (samePath(path, scope.mainDir) || samePath(path, scope.folderPath)) {
    throw refused('refusing to remove the project checkout')
  }
  if (isSymlink(path)) throw refused('refusing to remove a path that is not a worktree of this project')
  const registered = scope.entries.some((entry) =>
    !entry.bare
    && samePath(entry.path, path)
    && !samePath(entry.path, scope.mainDir)
    && !samePath(entry.path, scope.folderPath))
  if (registered) return
  const wtDir = planNewWorktreePaths({ mainDir: scope.mainDir, shortHash: '0' }).wtDir
  if (isDirectChildPath(wtDir, path) && realpathStaysDirectChild(wtDir, path)) return
  throw refused('refusing to remove a path that is not a worktree of this project')
}

async function addBranchWorktree(
  git: WorktreeGit,
  folderPath: string,
  mainDir: string,
  baseRef: string,
  branchName: string,
  targetHash: string,
  createBranch: boolean,
): Promise<ActivateWorktreeResult> {
  const planned = planNewWorktreePaths({ mainDir, shortHash: targetHash.slice(0, 7) })
  if (!existsSync(planned.wtDir)) mkdirSync(planned.wtDir, { recursive: true })
  const wtPath = allocateWorktreePath(planned.wtDir, basename(planned.wtPath))
  const args = createBranch
    ? ['worktree', ...worktreeAddArgs('branch', wtPath, baseRef, branchName)]
    : ['worktree', 'add', wtPath, branchName]
  await git.write(folderPath, args)
  return { path: wtPath, recordedBranch: branchName }
}

/**
 * Remove a collaboration checkout and its branch. Refuses the project root,
 * the project checkout itself, anything a session still uses, and any path
 * this repo does not have registered or under its own worktree directory.
 * The caller clears the activate receipt.
 */
export async function rollbackCollabWorktree(
  git: WorktreeGit,
  folderPath: string,
  input: { path: string; branchName?: string; isOccupied: (path: string) => boolean },
): Promise<void> {
  const mainDir = await resolveMainWorktreeDir(git, folderPath)
  await withRepoLock(mainDir, async () => {
    assertDeletableCheckout(input.path, { mainDir, folderPath, entries: await listWorktrees(git, folderPath) })
    if (input.isOccupied(input.path)) throw refused('worktree is in use by a session')
    await forceRemoveWorktree(git, folderPath, input.path, mainDir)
    if (!input.branchName) return
    try {
      await git.write(folderPath, ['branch', '-D', input.branchName])
    } catch (err) {
      if (!/not found|not a valid branch name/i.test(gitErrorMessage(err))) throw err
    }
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
export async function writeWorkingTree(git: WorktreeGit, worktreePath: string): Promise<string> {
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
