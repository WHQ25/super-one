import { existsSync } from 'fs'
import { join } from 'path'
import { gitRun } from '../git-run'
import { logGitFailure } from '../git-diagnostics'
import { sanitizeGitRef } from '../path-security'
import {
  gitErrorMessage as runtimeGitErrorMessage,
  worktreeGit,
  activateWorktree as activateWorktreeAt,
  assignBranch as assignBranchAt,
  carryUncommittedChanges as carryUncommittedChangesAt,
  handoffPreview,
  handoffToMain,
  resolveMainWorktreeDir as resolveMainWorktreeDirAt,
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

/**
 * The window's worktree flows run the runtime implementation on its
 * login-shell runner, so they queue on the same per-repo lock as the
 * `git.*` RPCs B serves to phones and controllers.
 */
const git = worktreeGit(gitRun)

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

export function resolveMainWorktreeDir(folderPath: string): Promise<string> {
  return resolveMainWorktreeDirAt(git, folderPath)
}

/**
 * Copy the source's uncommitted changes into a freshly created worktree.
 */
export function carryUncommittedChanges(sourceDir: string, worktreePath: string): Promise<void> {
  return carryUncommittedChangesAt(git, sourceDir, worktreePath)
}

export async function activateWorktree(
  folderPath: string,
  request: ActivateWorktreeRequest,
): Promise<ActivateWorktreeResult> {
  const { baseBranch, mode, branchName, carryLocalChanges } = request

  if (mode === 'branch' && (!branchName || !branchName.trim())) {
    throw new Error('Branch name is required for branch mode')
  }

  const result = await activateWorktreeAt(git, folderPath, {
    baseBranch: sanitizeGitRef(baseBranch),
    mode,
    branchName: mode === 'branch' ? sanitizeGitRef(branchName!.trim()) : undefined,
    carryLocalChanges,
  })
  return { ok: true, ...result }
}

export function getHandoffPreview(worktreePath: string): Promise<GitDirtyStatus | null> {
  return handoffPreview(git, worktreePath)
}

export async function handoffToLocal(worktreePath: string): Promise<WorktreeHandoffResult> {
  const result = await handoffToMain(git, worktreePath)
  // The window's copy calls the main checkout "local".
  if (result.ok) return result
  return { ...result, reason: result.reason === 'main-dirty' ? 'local-dirty' : result.reason }
}

export function assignBranch(worktreePath: string, rawName: string): Promise<WorktreeAssignResult> {
  return assignBranchAt(git, worktreePath, rawName)
}
