import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, join, resolve } from 'path'
import { gitRun } from '../git-run'
import { withRepoLock } from './repo-lock'
import { logGitFailure } from '../git-diagnostics'
import { sanitizeGitRef } from '../path-security'
import {
  gitErrorMessage as runtimeGitErrorMessage,
  resolveMainDirFromCommonDir,
  planNewWorktreePaths,
  worktreeAddArgs,
  recordedBranchForMode,
  parseNumstat,
  worktreeInfoFromPorcelain,
  checkedOutBranchesFromPorcelain,
} from '@superone/runtime/git'
import type {
  WorktreeMode,
  WorktreeInfo,
  WorktreeHandoffResult,
  WorktreeAssignResult,
  GitDirtyStatus,
} from '@superone/shared/agent-types'

export interface ActivateWorktreeRequest {
  baseBranch: string
  mode: WorktreeMode
  branchName?: string
  carryLocalChanges?: boolean
}

export interface ActivateWorktreeResult {
  ok: true
  path: string
  recordedBranch: string | null
}

export function gitErrorMessage(err: unknown): string {
  return runtimeGitErrorMessage(err)
}

/** Read-only, feeds the status bar — see GIT_READ_OPTS in main/index.ts. */
const WORKTREE_READ_OPTS = { timeoutMs: 20_000 }

export async function getWorktreeInfo(folderPath: string): Promise<WorktreeInfo | null> {
  try {
    const raw = await gitRun(folderPath, ['worktree', 'list', '--porcelain'], undefined, WORKTREE_READ_OPTS)
    return worktreeInfoFromPorcelain(raw, folderPath)
  } catch {
    try {
      const ref = await gitRun(folderPath, ['symbolic-ref', 'HEAD'], undefined, WORKTREE_READ_OPTS)
      const branch = ref.replace('refs/heads/', '')
      return {
        isWorktree: false,
        currentBranch: branch,
        entries: [{ path: folderPath, branch, head: '', isMain: true, isCurrent: true }],
      }
    } catch (err) {
      logGitFailure('WORKTREE_INFO', folderPath, err, existsSync(join(folderPath, '.git')))
      return null
    }
  }
}

export async function getCheckedOutBranches(folderPath: string): Promise<string[]> {
  try {
    const raw = await gitRun(folderPath, ['worktree', 'list', '--porcelain'])
    return checkedOutBranchesFromPorcelain(raw)
  } catch {
    return []
  }
}

export async function resolveMainWorktreeDir(folderPath: string): Promise<string> {
  const common = await gitRun(folderPath, ['rev-parse', '--git-common-dir'])
  return resolveMainDirFromCommonDir(folderPath, common)
}

/**
 * Copy the source's uncommitted changes into a freshly created worktree.
 */
export async function carryUncommittedChanges(sourceDir: string, worktreePath: string): Promise<void> {
  const stashTop = () =>
    gitRun(sourceDir, ['rev-parse', '-q', '--verify', 'refs/stash']).then((s) => s.trim()).catch(() => '')
  const before = await stashTop()
  await gitRun(sourceDir, ['stash', 'push', '-u', '-m', 'superone-carry']).catch(() => {})
  const after = await stashTop()
  if (!after || after === before) return
  try {
    await gitRun(worktreePath, ['stash', 'apply', after])
  } catch {
    /* ignore rare apply miss */
  }
  await gitRun(sourceDir, ['stash', 'pop']).catch(() => {})
}

export async function activateWorktree(
  folderPath: string,
  request: ActivateWorktreeRequest,
): Promise<ActivateWorktreeResult> {
  const { baseBranch, mode, branchName, carryLocalChanges } = request

  if (mode === 'branch' && (!branchName || !branchName.trim())) {
    throw new Error('Branch name is required for branch mode')
  }

  const mainDir = await resolveMainWorktreeDir(folderPath)
  const safeBase = sanitizeGitRef(baseBranch)
  const safeBranchName =
    mode === 'branch' ? sanitizeGitRef(branchName!.trim()) : undefined

  // `worktree add` and the carry stash both take repo-wide git locks, and the
  // second-resolution path stamp collides when two activations land in the same
  // second. Both break parallel session_collab_start — queue per repo.
  return withRepoLock(mainDir, async () => {
    const commitHash = (await gitRun(folderPath, ['rev-parse', safeBase])).trim()
    const planned = planNewWorktreePaths({
      mainDir,
      shortHash: commitHash.slice(0, 7),
    })
    if (!existsSync(planned.wtDir)) mkdirSync(planned.wtDir, { recursive: true })
    // planNewWorktreePaths uses epoch-second uniqueness only; suffix until free.
    const wtPath = allocateWorktreePath(planned.wtDir, basename(planned.wtPath))
    const addArgs = worktreeAddArgs(mode, wtPath, safeBase, safeBranchName)
    await gitRun(folderPath, ['worktree', ...addArgs])

    if (carryLocalChanges) {
      await carryUncommittedChanges(folderPath, wtPath)
    }

    return {
      ok: true,
      path: wtPath,
      recordedBranch: recordedBranchForMode(mode, safeBase, safeBranchName ?? branchName),
    }
  })
}

/**
 * `${epoch}-${shortHash}` is only unique per second, so sibling activations from
 * the same base commit would target one directory. Suffix until the name is
 * free — safe to probe because callers hold the repo lock.
 */
function allocateWorktreePath(wtDir: string, stem: string): string {
  for (let n = 0; n < 100; n++) {
    const candidate = join(wtDir, n === 0 ? stem : `${stem}-${n + 1}`)
    if (!existsSync(candidate)) return candidate
  }
  return join(wtDir, `${stem}-${randomUUID().slice(0, 8)}`)
}

async function writeWorkingTree(worktreePath: string): Promise<string> {
  const tmpIndex = join(tmpdir(), `s1-handoff-${randomUUID()}.index`)
  const env = { GIT_INDEX_FILE: tmpIndex }
  try {
    await gitRun(worktreePath, ['read-tree', 'HEAD'], env)
    await gitRun(worktreePath, ['add', '-A'], env)
    return (await gitRun(worktreePath, ['write-tree'], env)).trim()
  } finally {
    rmSync(tmpIndex, { force: true })
  }
}

type HandoffDiff =
  | { ok: true; localDir: string; base: string; tree: string; stat: GitDirtyStatus }
  | { ok: false; reason: 'not-worktree' | 'no-changes' }

async function buildHandoffDiff(worktreePath: string): Promise<HandoffDiff> {
  const localDir = await resolveMainWorktreeDir(worktreePath)
  if (resolve(localDir) === resolve(worktreePath)) return { ok: false, reason: 'not-worktree' }

  const [onBranch, worktreeHead, tree] = await Promise.all([
    gitRun(worktreePath, ['symbolic-ref', '-q', 'HEAD']).then(() => true).catch(() => false),
    gitRun(worktreePath, ['rev-parse', 'HEAD']).then((s) => s.trim()),
    writeWorkingTree(worktreePath),
  ])

  let base = worktreeHead
  if (!onBranch) {
    const localHead = (await gitRun(localDir, ['rev-parse', 'HEAD'])).trim()
    base =
      (await gitRun(worktreePath, ['merge-base', localHead, worktreeHead]).catch(() => worktreeHead)).trim() ||
      worktreeHead
  }

  const numstat = await gitRun(worktreePath, ['diff', '--numstat', base, tree])
  if (!numstat.trim()) return { ok: false, reason: 'no-changes' }
  return { ok: true, localDir, base, tree, stat: parseNumstat(numstat) }
}

export async function getHandoffPreview(worktreePath: string): Promise<GitDirtyStatus | null> {
  try {
    const diff = await buildHandoffDiff(worktreePath)
    if (diff.ok) return diff.stat
    return diff.reason === 'not-worktree' ? null : { files: 0, insertions: 0, deletions: 0 }
  } catch {
    return null
  }
}

export async function handoffToLocal(worktreePath: string): Promise<WorktreeHandoffResult> {
  const diff = await buildHandoffDiff(worktreePath)
  if (!diff.ok) return { ok: false, reason: diff.reason }

  const localStatus = (await gitRun(diff.localDir, ['status', '--porcelain'])).trim()
  if (localStatus) return { ok: false, reason: 'local-dirty' }

  const patch = await gitRun(worktreePath, ['diff', '--binary', diff.base, diff.tree])
  const patchFile = join(tmpdir(), `s1-handoff-${randomUUID()}.patch`)
  writeFileSync(patchFile, `${patch}\n`)
  try {
    await gitRun(diff.localDir, ['apply', '--3way', '--whitespace=nowarn', patchFile])
  } catch (err) {
    try {
      await gitRun(diff.localDir, ['reset', '--hard'])
      await gitRun(diff.localDir, ['clean', '-fd'])
    } catch {
      /* best-effort rollback */
    }
    return { ok: false, reason: 'conflict', error: gitErrorMessage(err) }
  } finally {
    rmSync(patchFile, { force: true })
  }

  await gitRun(diff.localDir, ['reset', '--quiet']).catch(() => {})
  return { ok: true }
}

export async function assignBranch(worktreePath: string, rawName: string): Promise<WorktreeAssignResult> {
  const name = rawName.trim()
  if (!name) return { ok: false, reason: 'name-required' }

  const onBranch = await gitRun(worktreePath, ['symbolic-ref', '-q', 'HEAD']).then(() => true).catch(() => false)
  if (onBranch) return { ok: false, reason: 'not-detached' }

  try {
    const safe = sanitizeGitRef(name)
    if (await getCheckedOutBranches(worktreePath).then((bs) => bs.includes(safe))) {
      return { ok: false, reason: 'checked-out' }
    }
    const exists = await gitRun(worktreePath, ['show-ref', '--verify', '--quiet', `refs/heads/${safe}`])
      .then(() => true)
      .catch(() => false)
    if (exists) return { ok: false, reason: 'exists' }

    await gitRun(worktreePath, ['switch', '-c', safe])
    return { ok: true, branch: safe }
  } catch (err) {
    return { ok: false, reason: 'error', error: gitErrorMessage(err) }
  }
}
