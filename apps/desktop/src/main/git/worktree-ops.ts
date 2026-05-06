import { existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { basename, dirname, join, resolve, sep } from 'path'
import { gitRun } from '../git-run'
import { sanitizeGitRef } from '../path-security'
import type { WorktreeMode, WorktreeInfo, WorktreeEntry } from '@superone/shared/agent-types'

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
  const stderr = (err as { stderr?: string })?.stderr?.trim()
  if (stderr) return stderr
  return (err as Error)?.message ?? 'Unknown git error'
}

export async function getWorktreeInfo(folderPath: string): Promise<WorktreeInfo | null> {
  try {
    const raw = await gitRun(folderPath, ['worktree', 'list', '--porcelain'])
    const entries: WorktreeEntry[] = []
    let first = true
    for (const block of raw.split('\n\n').filter(Boolean)) {
      const lines = block.split('\n')
      const pathLine = lines.find((l) => l.startsWith('worktree '))
      const branchLine = lines.find((l) => l.startsWith('branch '))
      const headLine = lines.find((l) => l.startsWith('HEAD '))
      if (!pathLine) continue
      const wtPath = pathLine.slice('worktree '.length)
      const head = headLine ? headLine.slice('HEAD '.length) : ''
      const branch = branchLine ? branchLine.slice('branch refs/heads/'.length) : ''
      entries.push({ path: wtPath, branch, head, isMain: first, isCurrent: wtPath === folderPath })
      first = false
    }
    const mainEntry = entries.find((e) => e.isMain)
    const isWorktree = mainEntry ? mainEntry.path !== folderPath : false
    const current = entries.find((e) => e.isCurrent)
    const currentBranch = current?.branch || (current?.head ? current.head.slice(0, 7) : '')
    return { isWorktree, currentBranch, entries }
  } catch {
    try {
      const ref = await gitRun(folderPath, ['symbolic-ref', 'HEAD'])
      const branch = ref.replace('refs/heads/', '')
      return {
        isWorktree: false,
        currentBranch: branch,
        entries: [{ path: folderPath, branch, head: '', isMain: true, isCurrent: true }],
      }
    } catch {
      return null
    }
  }
}

export async function getCheckedOutBranches(folderPath: string): Promise<string[]> {
  try {
    const raw = await gitRun(folderPath, ['worktree', 'list', '--porcelain'])
    const branches: string[] = []
    for (const block of raw.split('\n\n').filter(Boolean)) {
      const lines = block.split('\n')
      const branchLine = lines.find((l) => l.startsWith('branch '))
      if (branchLine) branches.push(branchLine.slice('branch refs/heads/'.length))
    }
    return branches
  } catch {
    return []
  }
}

export async function activateWorktree(
  folderPath: string,
  request: ActivateWorktreeRequest,
): Promise<ActivateWorktreeResult> {
  const { baseBranch, mode, branchName, carryLocalChanges } = request

  if (mode === 'branch' && (!branchName || !branchName.trim())) {
    throw new Error('Branch name is required for branch mode')
  }

  const repoRoot = resolve(folderPath, await gitRun(folderPath, ['rev-parse', '--git-common-dir']))
  const mainDir = repoRoot.endsWith(`${sep}.git`) ? dirname(repoRoot) : repoRoot
  const repoName = basename(mainDir)
  const safeBase = sanitizeGitRef(baseBranch)
  const commitHash = (await gitRun(folderPath, ['rev-parse', safeBase])).trim()
  const shortHash = commitHash.slice(0, 7)
  const epoch = Math.floor(Date.now() / 1000).toString(36)
  const wtDir = join(homedir(), '.worktrees', repoName)
  const wtPath = join(wtDir, `${epoch}-${shortHash}`)

  let stashSha: string | undefined
  if (carryLocalChanges) {
    stashSha = (await gitRun(folderPath, ['stash', 'create'])).trim() || undefined
  }

  if (!existsSync(wtDir)) mkdirSync(wtDir, { recursive: true })
  if (mode === 'branch') {
    const safeNewBranch = sanitizeGitRef(branchName!.trim())
    await gitRun(folderPath, ['worktree', 'add', '-b', safeNewBranch, wtPath, safeBase])
  } else if (mode === 'attach') {
    await gitRun(folderPath, ['worktree', 'add', wtPath, safeBase])
  } else {
    await gitRun(folderPath, ['worktree', 'add', '--detach', wtPath, safeBase])
  }

  if (stashSha) {
    await gitRun(wtPath, ['stash', 'apply', stashSha])
  }

  const recordedBranch = mode === 'branch' ? branchName!.trim() : mode === 'attach' ? baseBranch : null
  return { ok: true, path: wtPath, recordedBranch }
}
