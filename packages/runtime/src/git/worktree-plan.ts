/**
 * Pure worktree path/plan helpers shared by desktop and CLI.
 * Hosts still invoke git; these functions do not spawn processes.
 */

import { basename, dirname, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import type { WorktreeEntry, WorktreeInfo, WorktreeMode, GitDirtyStatus } from '@superone/shared/agent-types'
import { parseWorktreePorcelain } from './worktree-porcelain'

/** Map `rev-parse --git-common-dir` output to the main checkout directory. */
export function resolveMainDirFromCommonDir(folderPath: string, gitCommonDir: string): string {
  const repoRoot = resolve(folderPath, gitCommonDir.trim())
  return repoRoot.endsWith(`${sep}.git`) || repoRoot.endsWith('/.git')
    ? dirname(repoRoot)
    : repoRoot
}

export function planNewWorktreePaths(input: {
  mainDir: string
  shortHash: string
  nowMs?: number
  homeDir?: string
}): { wtDir: string; wtPath: string } {
  const home = input.homeDir ?? homedir()
  const repoName = basename(input.mainDir)
  const epoch = Math.floor((input.nowMs ?? Date.now()) / 1000).toString(36)
  const short = input.shortHash.slice(0, 7)
  const wtDir = join(home, '.worktrees', repoName)
  const wtPath = join(wtDir, `${epoch}-${short}`)
  return { wtDir, wtPath }
}

/** Args after `git worktree` for add (does not include the `worktree` token). */
export function worktreeAddArgs(
  mode: WorktreeMode,
  wtPath: string,
  baseRef: string,
  branchName?: string,
): string[] {
  if (mode === 'branch') {
    if (!branchName?.trim()) throw new Error('Branch name is required for branch mode')
    return ['add', '-b', branchName.trim(), wtPath, baseRef]
  }
  if (mode === 'attach') {
    return ['add', wtPath, baseRef]
  }
  return ['add', '--detach', wtPath, baseRef]
}

export function recordedBranchForMode(
  mode: WorktreeMode,
  baseBranch: string,
  branchName?: string,
): string | null {
  if (mode === 'branch') return branchName?.trim() ?? null
  if (mode === 'attach') return baseBranch
  return null
}

/** Parse `git diff --numstat` into dirty stats. */
export function parseNumstat(numstat: string): GitDirtyStatus {
  let files = 0
  let insertions = 0
  let deletions = 0
  for (const line of numstat.split('\n')) {
    if (!line.trim()) continue
    const [ins, del] = line.split('\t')
    files += 1
    insertions += Number(ins) || 0
    deletions += Number(del) || 0
  }
  return { files, insertions, deletions }
}

/**
 * Build status-bar WorktreeInfo from porcelain list output.
 * Prefers block-split form used by desktop; falls back to line parser.
 */
export function worktreeInfoFromPorcelain(raw: string, folderPath: string): WorktreeInfo {
  const normalizedFolder = folderPath.replace(/\\/g, '/')
  // Desktop historically split on blank lines between blocks
  const blocks = raw.split('\n\n').filter(Boolean)
  if (blocks.length > 0 && blocks.some((b) => b.startsWith('worktree '))) {
    const entries: WorktreeEntry[] = []
    let first = true
    for (const block of blocks) {
      const lines = block.split('\n')
      const pathLine = lines.find((l) => l.startsWith('worktree '))
      const branchLine = lines.find((l) => l.startsWith('branch '))
      const headLine = lines.find((l) => l.startsWith('HEAD '))
      if (!pathLine) continue
      const wtPath = pathLine.slice('worktree '.length)
      const head = headLine ? headLine.slice('HEAD '.length) : ''
      const branch = branchLine
        ? branchLine.slice('branch '.length).replace(/^refs\/heads\//, '')
        : ''
      entries.push({
        path: wtPath,
        branch,
        head,
        isMain: first,
        isCurrent: wtPath.replace(/\\/g, '/') === normalizedFolder || wtPath === folderPath,
      })
      first = false
    }
    if (entries.length > 0) {
      const mainEntry = entries.find((e) => e.isMain) ?? entries[0]!
      const current = entries.find((e) => e.isCurrent)
      const isWorktree = mainEntry.path.replace(/\\/g, '/') !== normalizedFolder
      const currentBranch =
        current?.branch || (current?.head ? current.head.slice(0, 7) : '') || ''
      return { isWorktree, currentBranch, entries }
    }
  }

  const listed = parseWorktreePorcelain(raw)
  const entries: WorktreeEntry[] = listed.map((wt, i) => ({
    path: wt.path,
    branch: wt.branch ?? '',
    head: wt.head ?? '',
    isMain: i === 0,
    isCurrent:
      wt.path.replace(/\\/g, '/') === normalizedFolder || wt.path === folderPath,
  }))
  if (entries.length === 0) {
    return {
      isWorktree: false,
      currentBranch: '',
      entries: [{ path: folderPath, branch: '', head: '', isMain: true, isCurrent: true }],
    }
  }
  const mainEntry = entries[0]!
  const current = entries.find((e) => e.isCurrent)
  return {
    isWorktree: mainEntry.path.replace(/\\/g, '/') !== normalizedFolder,
    currentBranch: current?.branch || (current?.head ? current.head.slice(0, 7) : '') || '',
    entries,
  }
}

export function checkedOutBranchesFromPorcelain(raw: string): string[] {
  const branches: string[] = []
  for (const wt of parseWorktreePorcelain(raw)) {
    if (wt.branch) branches.push(wt.branch)
  }
  // Also support block form with "branch refs/heads/..."
  if (branches.length === 0) {
    for (const block of raw.split('\n\n').filter(Boolean)) {
      const branchLine = block.split('\n').find((l) => l.startsWith('branch '))
      if (branchLine) {
        branches.push(branchLine.slice('branch '.length).replace(/^refs\/heads\//, ''))
      }
    }
  }
  return branches
}
