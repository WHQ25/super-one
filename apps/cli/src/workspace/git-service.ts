import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import {
  sanitizeGitRef as sanitizeGitRefCore,
  gitErrorMessage,
  parseShortstat,
  parseWorktreePorcelain,
  gitRunSync,
  resolveMainDirFromCommonDir,
  planNewWorktreePaths,
  worktreeAddArgs,
  recordedBranchForMode,
  parseNumstat,
} from '@superone/runtime/git'
import type { ProjectRegistry } from './project-registry'

export { parseShortstat } from '@superone/runtime/git'

export interface GitStatusResult {
  isRepo: boolean
  branch: string | null
  dirty: boolean
  ahead: number
  behind: number
  porcelain: string
  /** Tracked diff shortstat (0 when clean / unavailable). */
  insertions?: number
  deletions?: number
}

export interface GitDiffResult {
  diff: string
}

export interface WorktreeListEntry {
  path: string
  branch: string | null
  bare: boolean
  head?: string
}

export type WorktreeMode = 'branch' | 'attach' | 'detach'

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

/** Shared sync git runner (same flags as desktop async gitRun). */
function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return gitRunSync(cwd, args, env)
}

/** Reject flag injection; wrap core errors with invalid_argument for RPC. */
export function sanitizeGitRef(ref: string): string {
  try {
    return sanitizeGitRefCore(ref)
  } catch (err) {
    throw Object.assign(err instanceof Error ? err : new Error(String(err)), {
      code: 'invalid_argument',
    })
  }
}

function isGitWorktree(cwd: string): boolean {
  try {
    git(cwd, ['rev-parse', '--is-inside-work-tree'])
    return true
  } catch {
    return false
  }
}

function resolveMainWorktreeDir(folderPath: string): string {
  const common = git(folderPath, ['rev-parse', '--git-common-dir'])
  return resolveMainDirFromCommonDir(folderPath, common)
}

function samePath(a: string, b: string): boolean {
  try {
    const ra = existsSync(a) ? realpathSync(a) : resolve(a)
    const rb = existsSync(b) ? realpathSync(b) : resolve(b)
    return ra === rb
  } catch {
    return resolve(a) === resolve(b)
  }
}

export class WorkspaceGitService {
  constructor(private readonly projects: ProjectRegistry) {}

  private root(projectId: string): string {
    const p = this.projects.get(projectId)
    if (!p) throw Object.assign(new Error('project not found'), { code: 'not_found' })
    return p.path
  }

  status(projectId: string): GitStatusResult {
    const cwd = this.root(projectId)
    if (!existsSync(join(cwd, '.git')) && !isGitWorktree(cwd)) {
      return { isRepo: false, branch: null, dirty: false, ahead: 0, behind: 0, porcelain: '' }
    }
    try {
      const porcelain = git(cwd, ['status', '--porcelain=v1', '--ignored'])
      let branch: string | null = null
      try {
        branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()
      } catch {
        branch = null
      }
      let ahead = 0
      let behind = 0
      try {
        const counts = git(cwd, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']).trim()
        const [b, a] = counts.split(/\s+/).map(Number)
        behind = b || 0
        ahead = a || 0
      } catch {
        /* no upstream */
      }
      const dirty = porcelain.trim().length > 0
      const shortstat = dirty ? shortstatAt(cwd) : { insertions: 0, deletions: 0 }
      this.projects.touch(projectId)
      return {
        isRepo: true,
        branch,
        dirty,
        ahead,
        behind,
        porcelain,
        insertions: shortstat.insertions,
        deletions: shortstat.deletions,
      }
    } catch (err) {
      throw Object.assign(new Error((err as Error).message || 'git status failed'), {
        code: 'internal',
      })
    }
  }

  /** Status for an arbitrary allowed worktree path of this project (or project root). */
  statusAt(projectId: string, absolutePath?: string | null): GitStatusResult {
    if (!absolutePath) return this.status(projectId)
    const cwd = this.assertRepoWorktreePath(projectId, absolutePath)
    return this.statusForCwd(cwd)
  }

  private statusForCwd(cwd: string): GitStatusResult {
    if (!existsSync(join(cwd, '.git')) && !isGitWorktree(cwd)) {
      return { isRepo: false, branch: null, dirty: false, ahead: 0, behind: 0, porcelain: '' }
    }
    try {
      const porcelain = git(cwd, ['status', '--porcelain=v1', '--ignored'])
      let branch: string | null = null
      try {
        branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()
      } catch {
        branch = null
      }
      const dirty = porcelain.trim().length > 0
      const shortstat = dirty ? shortstatAt(cwd) : { insertions: 0, deletions: 0 }
      return {
        isRepo: true,
        branch,
        dirty,
        ahead: 0,
        behind: 0,
        porcelain,
        insertions: shortstat.insertions,
        deletions: shortstat.deletions,
      }
    } catch (err) {
      throw Object.assign(new Error((err as Error).message || 'git status failed'), {
        code: 'internal',
      })
    }
  }

  diff(projectId: string, opts?: { staged?: boolean; path?: string }): GitDiffResult {
    const cwd = this.root(projectId)
    const args = ['diff']
    if (opts?.staged) args.push('--cached')
    if (opts?.path) {
      if (opts.path.startsWith('/') || opts.path.includes('..')) {
        throw Object.assign(new Error('invalid diff path'), { code: 'invalid_argument' })
      }
      args.push('--', opts.path)
    }
    try {
      const diff = git(cwd, args)
      this.projects.touch(projectId)
      return { diff }
    } catch (err) {
      throw Object.assign(new Error((err as Error).message || 'git diff failed'), { code: 'internal' })
    }
  }

  branches(projectId: string, absolutePath?: string | null): { current: string | null; branches: string[] } {
    const cwd = absolutePath
      ? this.assertRepoWorktreePath(projectId, absolutePath)
      : this.root(projectId)
    try {
      const out = git(cwd, ['branch', '--format=%(refname:short)'])
      const branches = out
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
      let current: string | null = null
      try {
        current = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()
      } catch {
        current = null
      }
      return { current, branches }
    } catch (err) {
      throw Object.assign(new Error((err as Error).message || 'git branch failed'), { code: 'internal' })
    }
  }

  /** Checkout existing branch (or create with create=true). Operates at project root or allowed worktree. */
  switchBranch(
    projectId: string,
    branch: string,
    opts?: { create?: boolean; absolutePath?: string | null },
  ): { ok: true } | { ok: false; error: string } {
    try {
      const cwd = opts?.absolutePath
        ? this.assertRepoWorktreePath(projectId, opts.absolutePath)
        : this.root(projectId)
      const safe = sanitizeGitRef(branch)
      if (opts?.create) {
        try {
          git(cwd, ['rev-parse', '--verify', 'HEAD'])
        } catch {
          return {
            ok: false,
            error:
              'Cannot create a new branch before the first commit. Commit once, then create the branch.',
          }
        }
        git(cwd, ['checkout', '-b', safe])
      } else {
        git(cwd, ['checkout', safe])
      }
      this.projects.touch(projectId)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: gitErrorMessage(err) }
    }
  }

  worktrees(projectId: string): WorktreeListEntry[] {
    const cwd = this.root(projectId)
    try {
      return parseWorktreePorcelain(git(cwd, ['worktree', 'list', '--porcelain']))
    } catch {
      return []
    }
  }

  checkedOutBranches(projectId: string): string[] {
    const branches: string[] = []
    for (const wt of this.worktrees(projectId)) {
      if (wt.branch) branches.push(wt.branch)
    }
    return branches
  }

  /**
   * Ensure absolutePath is the project root or a git worktree of the same repo.
   */
  assertRepoWorktreePath(projectId: string, worktreePath: string): string {
    if (!worktreePath || typeof worktreePath !== 'string') {
      throw Object.assign(new Error('worktreePath required'), { code: 'invalid_argument' })
    }
    if (worktreePath.includes('\0') || worktreePath.includes('..')) {
      throw Object.assign(new Error('invalid worktree path'), { code: 'invalid_argument' })
    }
    const abs = resolve(worktreePath)
    const main = resolve(this.root(projectId))
    if (samePath(abs, main)) return existsSync(abs) ? realpathSync(abs) : abs

    const listed = this.worktrees(projectId)
    for (const wt of listed) {
      if (samePath(abs, wt.path)) {
        return existsSync(abs) ? realpathSync(abs) : resolve(wt.path)
      }
    }

    // Fallback: same git-common-dir as project
    try {
      if (existsSync(abs) && isGitWorktree(abs)) {
        const commonA = resolve(abs, git(abs, ['rev-parse', '--git-common-dir']).trim())
        const commonB = resolve(main, git(main, ['rev-parse', '--git-common-dir']).trim())
        if (samePath(commonA, commonB)) {
          return realpathSync(abs)
        }
      }
    } catch {
      /* deny */
    }
    throw Object.assign(new Error('path is not a worktree of this project'), {
      code: 'invalid_argument',
    })
  }

  /** Whether cwd may be used for agent turns (project root or known worktree). */
  isAllowedSessionCwd(projectId: string, cwd: string | null | undefined): boolean {
    if (!cwd) return true
    try {
      this.assertRepoWorktreePath(projectId, cwd)
      return true
    } catch {
      return false
    }
  }

  activateWorktree(projectId: string, input: ActivateWorktreeInput): ActivateWorktreeResult {
    const { mode, branchName, carryLocalChanges } = input
    if (mode === 'branch' && (!branchName || !branchName.trim())) {
      throw Object.assign(new Error('Branch name is required for branch mode'), {
        code: 'invalid_argument',
      })
    }
    const folderPath = this.root(projectId)
    if (!isGitWorktree(folderPath)) {
      throw Object.assign(new Error('project is not a git repository'), { code: 'failed_precondition' })
    }

    const baseBranch = sanitizeGitRef(input.baseBranch)
    const safeBranchName =
      mode === 'branch' ? sanitizeGitRef(branchName!.trim()) : undefined
    const mainDir = resolveMainWorktreeDir(folderPath)
    const commitHash = git(folderPath, ['rev-parse', baseBranch]).trim()
    const { wtDir, wtPath } = planNewWorktreePaths({
      mainDir,
      shortHash: commitHash.slice(0, 7),
    })

    if (!existsSync(wtDir)) mkdirSync(wtDir, { recursive: true })

    try {
      const addArgs = worktreeAddArgs(mode, wtPath, baseBranch, safeBranchName)
      git(folderPath, ['worktree', ...addArgs])
    } catch (err) {
      throw Object.assign(new Error(gitErrorMessage(err) || 'git worktree add failed'), {
        code: 'internal',
      })
    }

    if (carryLocalChanges) {
      this.carryUncommittedChanges(folderPath, wtPath)
    }

    const recordedBranch = recordedBranchForMode(mode, baseBranch, safeBranchName ?? branchName)
    this.projects.touch(projectId)
    return { path: wtPath, recordedBranch }
  }

  private carryUncommittedChanges(sourceDir: string, worktreePath: string): void {
    const stashTop = (): string => {
      try {
        return git(sourceDir, ['rev-parse', '-q', '--verify', 'refs/stash']).trim()
      } catch {
        return ''
      }
    }
    const before = stashTop()
    try {
      git(sourceDir, ['stash', 'push', '-u', '-m', 'superone-carry'])
    } catch {
      /* nothing to stash */
    }
    const after = stashTop()
    if (!after || after === before) return
    try {
      git(worktreePath, ['stash', 'apply', after])
    } catch {
      /* ignore rare apply miss */
    }
    try {
      git(sourceDir, ['stash', 'pop'])
    } catch {
      /* changes stay in stash */
    }
  }

  assignBranch(projectId: string, worktreePath: string, rawName: string): AssignBranchResult {
    const wt = this.assertRepoWorktreePath(projectId, worktreePath)
    const name = rawName.trim()
    if (!name) return { ok: false, reason: 'name-required' }

    let onBranch = false
    try {
      git(wt, ['symbolic-ref', '-q', 'HEAD'])
      onBranch = true
    } catch {
      onBranch = false
    }
    if (onBranch) return { ok: false, reason: 'not-detached' }

    try {
      const safe = sanitizeGitRef(name)
      if (this.checkedOutBranches(projectId).includes(safe)) {
        return { ok: false, reason: 'checked-out' }
      }
      const exists = (() => {
        try {
          git(wt, ['show-ref', '--verify', '--quiet', `refs/heads/${safe}`])
          return true
        } catch {
          return false
        }
      })()
      if (exists) return { ok: false, reason: 'exists' }
      git(wt, ['switch', '-c', safe])
      return { ok: true, branch: safe }
    } catch (err) {
      return { ok: false, reason: 'error', error: gitErrorMessage(err) }
    }
  }

  handoffPreview(projectId: string, worktreePath: string): HandoffPreview | null {
    try {
      const diff = this.buildHandoffDiff(projectId, worktreePath)
      if (diff.ok) return diff.stat
      return diff.reason === 'not-worktree' ? null : { files: 0, insertions: 0, deletions: 0 }
    } catch {
      return null
    }
  }

  handoffToMain(projectId: string, worktreePath: string): HandoffResult {
    try {
      const diff = this.buildHandoffDiff(projectId, worktreePath)
      if (!diff.ok) return { ok: false, reason: diff.reason }

      const mainStatus = git(diff.mainDir, ['status', '--porcelain']).trim()
      if (mainStatus) return { ok: false, reason: 'main-dirty' }

      const patch = git(diff.worktreePath, ['diff', '--binary', diff.base, diff.tree])
      const patchFile = join(tmpdir(), `s1-handoff-${randomUUID()}.patch`)
      writeFileSync(patchFile, `${patch}\n`)
      // Narrow the TOCTOU window before mutating main; reset --hard on failure is only
      // safe if main was clean immediately before apply (not just at the first check).
      if (git(diff.mainDir, ['status', '--porcelain']).trim()) {
        rmSync(patchFile, { force: true })
        return { ok: false, reason: 'main-dirty' }
      }
      try {
        git(diff.mainDir, ['apply', '--3way', '--whitespace=nowarn', patchFile])
      } catch (err) {
        try {
          git(diff.mainDir, ['reset', '--hard'])
          git(diff.mainDir, ['clean', '-fd'])
        } catch {
          /* best-effort */
        }
        return { ok: false, reason: 'conflict', error: gitErrorMessage(err) }
      } finally {
        rmSync(patchFile, { force: true })
      }
      try {
        git(diff.mainDir, ['reset', '--quiet'])
      } catch {
        /* ignore */
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, reason: 'error', error: gitErrorMessage(err) }
    }
  }

  private buildHandoffDiff(
    projectId: string,
    worktreePath: string,
  ):
    | {
        ok: true
        mainDir: string
        worktreePath: string
        base: string
        tree: string
        stat: HandoffPreview
      }
    | { ok: false; reason: 'not-worktree' | 'no-changes' } {
    const wt = this.assertRepoWorktreePath(projectId, worktreePath)
    const mainDir = resolveMainWorktreeDir(this.root(projectId))
    if (samePath(mainDir, wt)) return { ok: false, reason: 'not-worktree' }

    let onBranch = false
    try {
      git(wt, ['symbolic-ref', '-q', 'HEAD'])
      onBranch = true
    } catch {
      onBranch = false
    }
    const worktreeHead = git(wt, ['rev-parse', 'HEAD']).trim()
    const tree = this.writeWorkingTree(wt)

    let base = worktreeHead
    if (!onBranch) {
      const mainHead = git(mainDir, ['rev-parse', 'HEAD']).trim()
      try {
        base = git(wt, ['merge-base', mainHead, worktreeHead]).trim() || worktreeHead
      } catch {
        base = worktreeHead
      }
    }

    const numstat = git(wt, ['diff', '--numstat', base, tree])
    if (!numstat.trim()) return { ok: false, reason: 'no-changes' }
    return {
      ok: true,
      mainDir,
      worktreePath: wt,
      base,
      tree,
      stat: parseNumstat(numstat),
    }
  }

  private writeWorkingTree(worktreePath: string): string {
    const tmpIndex = join(tmpdir(), `s1-handoff-${randomUUID()}.index`)
    const env = { GIT_INDEX_FILE: tmpIndex }
    try {
      git(worktreePath, ['read-tree', 'HEAD'], env)
      git(worktreePath, ['add', '-A'], env)
      return git(worktreePath, ['write-tree'], env).trim()
    } finally {
      rmSync(tmpIndex, { force: true })
    }
  }

  repoIdentity(projectId: string): string | null {
    return this.projects.get(projectId)?.repoIdentity ?? null
  }
}

function shortstatAt(cwd: string): { insertions: number; deletions: number } {
  try {
    return parseShortstat(git(cwd, ['diff', 'HEAD', '--shortstat']))
  } catch {
    return { insertions: 0, deletions: 0 }
  }
}
