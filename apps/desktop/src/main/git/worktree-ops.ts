import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { basename, dirname, join, resolve, sep } from 'path'
import { gitRun } from '../git-run'
import { sanitizeGitRef } from '../path-security'
import type {
  WorktreeMode,
  WorktreeInfo,
  WorktreeEntry,
  WorktreeHandoffResult,
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

export async function resolveMainWorktreeDir(folderPath: string): Promise<string> {
  const repoRoot = resolve(folderPath, await gitRun(folderPath, ['rev-parse', '--git-common-dir']))
  return repoRoot.endsWith(`${sep}.git`) ? dirname(repoRoot) : repoRoot
}

/**
 * Copy the source's uncommitted changes — staged, unstaged AND untracked — into
 * a freshly created worktree, leaving the source exactly as it was.
 *
 * Uses `git stash push -u`: `git stash create` silently ignores `-u`, so it
 * would drop untracked files. `push` clears the source, so the entry is
 * immediately popped back — the source is bare only for the push→apply→pop
 * window. The `refs/stash` before/after check guarantees a pre-existing stash
 * is never mistaken for the one we just created.
 */
export async function carryUncommittedChanges(sourceDir: string, worktreePath: string): Promise<void> {
  const stashTop = () =>
    gitRun(sourceDir, ['rev-parse', '-q', '--verify', 'refs/stash']).then((s) => s.trim()).catch(() => '')
  const before = await stashTop()
  await gitRun(sourceDir, ['stash', 'push', '-u', '-m', 'superone-carry']).catch(() => {})
  const after = await stashTop()
  if (!after || after === before) return // nothing was stashed
  try {
    await gitRun(worktreePath, ['stash', 'apply', after])
  } catch {
    /* a fresh worktree shares the source's base, so a clean apply is expected — ignore the rare miss */
  }
  await gitRun(sourceDir, ['stash', 'pop']).catch(() => { /* changes stay safe in the stash */ })
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
  const repoName = basename(mainDir)
  const safeBase = sanitizeGitRef(baseBranch)
  const commitHash = (await gitRun(folderPath, ['rev-parse', safeBase])).trim()
  const shortHash = commitHash.slice(0, 7)
  const epoch = Math.floor(Date.now() / 1000).toString(36)
  const wtDir = join(homedir(), '.worktrees', repoName)
  const wtPath = join(wtDir, `${epoch}-${shortHash}`)

  if (!existsSync(wtDir)) mkdirSync(wtDir, { recursive: true })
  if (mode === 'branch') {
    const safeNewBranch = sanitizeGitRef(branchName!.trim())
    await gitRun(folderPath, ['worktree', 'add', '-b', safeNewBranch, wtPath, safeBase])
  } else if (mode === 'attach') {
    await gitRun(folderPath, ['worktree', 'add', wtPath, safeBase])
  } else {
    await gitRun(folderPath, ['worktree', 'add', '--detach', wtPath, safeBase])
  }

  // Carry after the worktree exists so the source is cleared only for the brief
  // stash round-trip — not for the slower `git worktree add`.
  if (carryLocalChanges) {
    await carryUncommittedChanges(folderPath, wtPath)
  }

  const recordedBranch = mode === 'branch' ? branchName!.trim() : mode === 'attach' ? baseBranch : null
  return { ok: true, path: wtPath, recordedBranch }
}

/**
 * Capture the worktree's complete working state — committed work plus staged,
 * unstaged and untracked changes — as a tree object, without touching the
 * worktree's real index. A throwaway GIT_INDEX_FILE is seeded from HEAD, staged
 * with `add -A`, then written out. `git diff <commit>` alone cannot see
 * untracked files, so this round-trip is what makes the handoff complete.
 */
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

function parseNumstat(numstat: string): GitDirtyStatus {
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

type HandoffDiff =
  | { ok: true; localDir: string; base: string; tree: string; stat: GitDirtyStatus }
  | { ok: false; reason: 'not-worktree' | 'no-changes' }

/**
 * Resolve what a handoff would carry: the diff from a base commit to the
 * worktree's full working state. The handoff target is the local folder — the
 * repo's main worktree — whatever branch it happens to be checked out on.
 *
 * Detached worktrees have no branch to merge or PR, so their commits are part
 * of the handoff — the base is the fork point (`merge-base` with the local
 * folder's HEAD) and the whole detached line collapses into one diff. Branch
 * worktrees keep their commits on the branch (those go through merge/PR), so the
 * base is the branch tip and only uncommitted work is carried.
 */
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
    base = (await gitRun(worktreePath, ['merge-base', localHead, worktreeHead]).catch(() => worktreeHead)).trim() || worktreeHead
  }

  const numstat = await gitRun(worktreePath, ['diff', '--numstat', base, tree])
  if (!numstat.trim()) return { ok: false, reason: 'no-changes' }
  return { ok: true, localDir, base, tree, stat: parseNumstat(numstat) }
}

/** Stat of what {@link handoffToLocal} would carry, or null when not a worktree. */
export async function getHandoffPreview(worktreePath: string): Promise<GitDirtyStatus | null> {
  try {
    const diff = await buildHandoffDiff(worktreePath)
    if (diff.ok) return diff.stat
    return diff.reason === 'not-worktree' ? null : { files: 0, insertions: 0, deletions: 0 }
  } catch {
    return null
  }
}

/**
 * Hand off a worktree's changes to the local folder's working tree in one step.
 *
 * The worktree's divergence (see {@link buildHandoffDiff}) is squashed into a
 * single patch and applied to the local folder as uncommitted changes. The
 * source worktree is never modified — handoff is a non-destructive copy.
 *
 * It refuses if the local folder is dirty, and if the patch conflicts it rolls
 * the local folder back to its clean state, so nothing is ever lost.
 */
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
    } catch { /* best-effort rollback */ }
    return { ok: false, reason: 'conflict', error: gitErrorMessage(err) }
  } finally {
    rmSync(patchFile, { force: true })
  }

  // A 3-way apply stages the paths it merges; unstage everything so the handoff
  // lands as one uniform unstaged diff for the user to review and commit.
  await gitRun(diff.localDir, ['reset', '--quiet']).catch(() => {})
  return { ok: true }
}
