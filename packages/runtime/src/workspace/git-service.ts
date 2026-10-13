import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import {
  sanitizeGitRef as sanitizeGitRefCore,
  gitErrorMessage,
  parseShortstat,
  parseWorktreePorcelain,
  ghRun,
  gitRun,
  fetchRemoteCommands,
  listGitMentionRefs,
  probeGitMentionCapabilities,
  type GitMentionRunners,
  resolveMainDirFromCommonDir,
  planNewWorktreePaths,
  allocateWorktreePath,
  withRepoLock,
  worktreeAddArgs,
  recordedBranchForMode,
  parseNumstat,
} from '@superone/runtime/git'
import type { WorkspaceProjects } from './workspace-projects'
import type { GitMentionCapabilities, GitMentionRefKind, GitMentionRefsResult } from '@superone/shared/git-mention-query'

/** GitHub round-trips for `@gh`; a popup must never wait longer than this. */
const GH_TIMEOUT_MS = 15_000
/**
 * Reads feed status bars, pickers and path checks: a git stuck on a lock or a
 * slow filesystem fails them instead of leaving the request pending forever.
 * Mutations stay untimed so they are never half-killed.
 */
const GIT_READ_OPTS = { timeoutMs: 20_000 }

export { parseShortstat } from '@superone/runtime/git'

export interface GitStatusResult {
  isRepo: boolean
  branch: string | null
  /** Commit label for a detached checkout. */
  head?: string
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

export interface WorkspaceGitServiceOptions {
  /** Process runners; a host may wrap them (e.g. to spawn on its login-shell PATH). */
  gitRun?: typeof gitRun
  ghRun?: typeof ghRun
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
  private readonly runGit: typeof gitRun
  private readonly runGh: typeof ghRun

  constructor(
    private readonly projects: WorkspaceProjects,
    opts: WorkspaceGitServiceOptions = {},
  ) {
    this.runGit = opts.gitRun ?? gitRun
    this.runGh = opts.ghRun ?? ghRun
  }

  /** Read-only git, killed after {@link GIT_READ_OPTS}. */
  private read(cwd: string, args: string[]): Promise<string> {
    return this.runGit(cwd, args, undefined, GIT_READ_OPTS)
  }

  /** Mutating git; never timed out. */
  private write(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
    return this.runGit(cwd, args, env)
  }

  private async isGitWorktree(cwd: string): Promise<boolean> {
    try {
      await this.read(cwd, ['rev-parse', '--is-inside-work-tree'])
      return true
    } catch {
      return false
    }
  }

  private async resolveMainWorktreeDir(folderPath: string): Promise<string> {
    const common = await this.read(folderPath, ['rev-parse', '--git-common-dir'])
    return resolveMainDirFromCommonDir(folderPath, common)
  }

  private root(projectId: string): string {
    const p = this.projects.get(projectId)
    if (!p) throw Object.assign(new Error('project not found'), { code: 'not_found' })
    return p.path
  }

  async status(projectId: string): Promise<GitStatusResult> {
    const cwd = this.root(projectId)
    const result = await this.statusForCwd(cwd)
    if (result.isRepo) this.projects.touch(projectId)
    return result
  }

  /** Status for an arbitrary allowed worktree path of this project (or project root). */
  async statusAt(projectId: string, absolutePath?: string | null): Promise<GitStatusResult> {
    if (!absolutePath) return this.status(projectId)
    const cwd = await this.assertRepoWorktreePath(projectId, absolutePath)
    return this.statusForCwd(cwd)
  }

  /**
   * Fast path for status-bar / file-tree: one `git status -b --porcelain` (no --ignored).
   * --ignored walks the whole tree of ignored paths and dominates remote latency.
   */
  private async statusForCwd(cwd: string): Promise<GitStatusResult> {
    if (!existsSync(join(cwd, '.git')) && !(await this.isGitWorktree(cwd))) {
      return { isRepo: false, branch: null, dirty: false, ahead: 0, behind: 0, porcelain: '' }
    }
    try {
      // Single process: branch header + file lines. No --ignored (expensive on large trees).
      const raw = await this.read(cwd, ['status', '--porcelain=v1', '-b'])
      const parsed = parseBranchPorcelain(raw)
      const dirty = parsed.porcelain.trim().length > 0
      // shortstat only when dirty — clean trees skip the extra git invocation.
      const shortstat = dirty ? await this.shortstatAt(cwd) : { insertions: 0, deletions: 0 }
      return {
        isRepo: true,
        branch: parsed.branch,
        ...(parsed.branch === null
          ? { head: (await this.read(cwd, ['rev-parse', '--short=7', 'HEAD'])).trim() }
          : {}),
        dirty,
        ahead: parsed.ahead,
        behind: parsed.behind,
        porcelain: parsed.porcelain,
        insertions: shortstat.insertions,
        deletions: shortstat.deletions,
      }
    } catch (err) {
      // stderr carries the reason the desktop status bar shows (license,
      // dubious ownership…); the process error's message is just "Command failed".
      throw Object.assign(new Error(gitErrorMessage(err) || 'git status failed'), {
        code: 'internal',
      })
    }
  }

  private async shortstatAt(cwd: string): Promise<{ insertions: number; deletions: number }> {
    try {
      return parseShortstat(await this.read(cwd, ['diff', 'HEAD', '--shortstat']))
    } catch {
      return { insertions: 0, deletions: 0 }
    }
  }

  async diff(projectId: string, opts?: { staged?: boolean; path?: string }): Promise<GitDiffResult> {
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
      const diff = await this.read(cwd, args)
      this.projects.touch(projectId)
      return { diff }
    } catch (err) {
      throw Object.assign(new Error((err as Error).message || 'git diff failed'), { code: 'internal' })
    }
  }

  async branches(
    projectId: string,
    absolutePath?: string | null,
  ): Promise<{ current: string | null; branches: string[] }> {
    const cwd = absolutePath
      ? await this.assertRepoWorktreePath(projectId, absolutePath)
      : this.root(projectId)
    try {
      const out = await this.read(cwd, ['branch', '--format=%(refname:short)'])
      const branches = out
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
      let current: string | null = null
      try {
        current = (await this.read(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
      } catch {
        current = null
      }
      return { current, branches }
    } catch (err) {
      throw Object.assign(new Error((err as Error).message || 'git branch failed'), { code: 'internal' })
    }
  }

  /** Checkout existing branch (or create with create=true). Operates at project root or allowed worktree. */
  async switchBranch(
    projectId: string,
    branch: string,
    opts?: { create?: boolean; absolutePath?: string | null },
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const cwd = opts?.absolutePath
        ? await this.assertRepoWorktreePath(projectId, opts.absolutePath)
        : this.root(projectId)
      const safe = sanitizeGitRef(branch)
      if (opts?.create) {
        try {
          await this.read(cwd, ['rev-parse', '--verify', 'HEAD'])
        } catch {
          return {
            ok: false,
            error:
              'Cannot create a new branch before the first commit. Commit once, then create the branch.',
          }
        }
        await this.write(cwd, ['checkout', '-b', safe])
      } else {
        await this.write(cwd, ['checkout', safe])
      }
      this.projects.touch(projectId)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: gitErrorMessage(err) }
    }
  }

  /** `@git` / `@gh` popup rows; `absolutePath` narrows to a linked worktree of the project. */
  async mentionRefs(
    projectId: string,
    kind: GitMentionRefKind,
    query: string,
    absolutePath?: string | null,
  ): Promise<GitMentionRefsResult> {
    return listGitMentionRefs(kind, query, await this.mentionRunners(projectId, absolutePath))
  }

  /** What the `@git` / `@gh` portals may offer for the project (or one of its worktrees). */
  async mentionCapabilities(projectId: string, absolutePath?: string | null): Promise<GitMentionCapabilities> {
    return probeGitMentionCapabilities(await this.mentionRunners(projectId, absolutePath))
  }

  private async mentionRunners(projectId: string, absolutePath?: string | null): Promise<GitMentionRunners> {
    const cwd = absolutePath
      ? await this.assertRepoWorktreePath(projectId, absolutePath)
      : this.root(projectId)
    return {
      git: (args) => this.read(cwd, args),
      gh: (args) => this.runGh(cwd, args, GH_TIMEOUT_MS),
    }
  }

  async worktrees(projectId: string): Promise<WorktreeListEntry[]> {
    const cwd = this.root(projectId)
    try {
      return parseWorktreePorcelain(await this.read(cwd, ['worktree', 'list', '--porcelain']))
    } catch {
      return []
    }
  }

  async checkedOutBranches(projectId: string): Promise<string[]> {
    const branches: string[] = []
    for (const wt of await this.worktrees(projectId)) {
      if (wt.branch) branches.push(wt.branch)
    }
    return branches
  }

  /**
   * Ensure absolutePath is the project root or a git worktree of the same repo.
   */
  async assertRepoWorktreePath(projectId: string, worktreePath: string): Promise<string> {
    if (!worktreePath || typeof worktreePath !== 'string') {
      throw Object.assign(new Error('worktreePath required'), { code: 'invalid_argument' })
    }
    if (worktreePath.includes('\0') || worktreePath.includes('..')) {
      throw Object.assign(new Error('invalid worktree path'), { code: 'invalid_argument' })
    }
    const abs = resolve(worktreePath)
    const main = resolve(this.root(projectId))
    if (samePath(abs, main)) return existsSync(abs) ? realpathSync(abs) : abs

    const listed = await this.worktrees(projectId)
    for (const wt of listed) {
      if (samePath(abs, wt.path)) {
        return existsSync(abs) ? realpathSync(abs) : resolve(wt.path)
      }
    }

    // Fallback: same git-common-dir as project
    try {
      if (existsSync(abs) && (await this.isGitWorktree(abs))) {
        const commonA = resolve(abs, (await this.read(abs, ['rev-parse', '--git-common-dir'])).trim())
        const commonB = resolve(main, (await this.read(main, ['rev-parse', '--git-common-dir'])).trim())
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
  async isAllowedSessionCwd(projectId: string, cwd: string | null | undefined): Promise<boolean> {
    if (!cwd) return true
    try {
      await this.assertRepoWorktreePath(projectId, cwd)
      return true
    } catch {
      return false
    }
  }

  async activateWorktree(projectId: string, input: ActivateWorktreeInput): Promise<ActivateWorktreeResult> {
    const { mode, branchName, carryLocalChanges } = input
    if (mode === 'branch' && (!branchName || !branchName.trim())) {
      throw Object.assign(new Error('Branch name is required for branch mode'), {
        code: 'invalid_argument',
      })
    }
    const folderPath = this.root(projectId)
    if (!(await this.isGitWorktree(folderPath))) {
      throw Object.assign(new Error('project is not a git repository'), { code: 'failed_precondition' })
    }

    const baseBranch = sanitizeGitRef(input.baseBranch)
    const safeBranchName =
      mode === 'branch' ? sanitizeGitRef(branchName!.trim()) : undefined
    const mainDir = await this.resolveMainWorktreeDir(folderPath)

    // `worktree add` and the carry stash take repo-wide locks, and two carries
    // interleaving pop each other's (or the user's) stash. Shared with the
    // desktop window's activations in the same process.
    return withRepoLock(mainDir, async () => {
      const commitHash = (await this.read(folderPath, ['rev-parse', baseBranch])).trim()
      const planned = planNewWorktreePaths({
        mainDir,
        shortHash: commitHash.slice(0, 7),
      })

      if (!existsSync(planned.wtDir)) mkdirSync(planned.wtDir, { recursive: true })
      const wtPath = allocateWorktreePath(planned.wtDir, basename(planned.wtPath))

      try {
        const addArgs = worktreeAddArgs(mode, wtPath, baseBranch, safeBranchName)
        await this.write(folderPath, ['worktree', ...addArgs])
      } catch (err) {
        throw Object.assign(new Error(gitErrorMessage(err) || 'git worktree add failed'), {
          code: 'internal',
        })
      }

      if (carryLocalChanges) {
        await this.carryUncommittedChanges(folderPath, wtPath)
      }

      const recordedBranch = recordedBranchForMode(mode, baseBranch, safeBranchName ?? branchName)
      this.projects.touch(projectId)
      return { path: wtPath, recordedBranch }
    })
  }

  async fetch(projectId: string, remote: string): Promise<void> {
    const folderPath = this.root(projectId)
    const { fetch, setHead } = fetchRemoteCommands(remote)
    try {
      await this.write(folderPath, fetch)
    } catch (err) {
      throw Object.assign(new Error(gitErrorMessage(err) || 'git fetch failed'), { code: 'failed_precondition' })
    }
    try {
      await this.write(folderPath, setHead)
    } catch {
      /* the remote may have no default branch to point at */
    }
  }

  /** Best-effort cleanup after a failed session.fork worktree path. */
  async removeWorktree(projectId: string, worktreePath: string): Promise<void> {
    const folderPath = this.root(projectId)
    try {
      await this.write(folderPath, ['worktree', 'remove', '--force', worktreePath])
    } catch {
      /* ignore — caller already failed for another reason */
    }
  }

  private async carryUncommittedChanges(sourceDir: string, worktreePath: string): Promise<void> {
    const stashTop = async (): Promise<string> => {
      try {
        return (await this.read(sourceDir, ['rev-parse', '-q', '--verify', 'refs/stash'])).trim()
      } catch {
        return ''
      }
    }
    const before = await stashTop()
    try {
      await this.write(sourceDir, ['stash', 'push', '-u', '-m', 'superone-carry'])
    } catch {
      /* nothing to stash */
    }
    const after = await stashTop()
    if (!after || after === before) return
    try {
      await this.write(worktreePath, ['stash', 'apply', after])
    } catch {
      /* ignore rare apply miss */
    }
    try {
      await this.write(sourceDir, ['stash', 'pop'])
    } catch {
      /* changes stay in stash */
    }
  }

  private async isOnBranch(cwd: string): Promise<boolean> {
    try {
      await this.read(cwd, ['symbolic-ref', '-q', 'HEAD'])
      return true
    } catch {
      return false
    }
  }

  async assignBranch(projectId: string, worktreePath: string, rawName: string): Promise<AssignBranchResult> {
    const wt = await this.assertRepoWorktreePath(projectId, worktreePath)
    const name = rawName.trim()
    if (!name) return { ok: false, reason: 'name-required' }

    if (await this.isOnBranch(wt)) return { ok: false, reason: 'not-detached' }

    try {
      const safe = sanitizeGitRef(name)
      if ((await this.checkedOutBranches(projectId)).includes(safe)) {
        return { ok: false, reason: 'checked-out' }
      }
      const exists = await this.read(wt, ['show-ref', '--verify', '--quiet', `refs/heads/${safe}`]).then(
        () => true,
        () => false,
      )
      if (exists) return { ok: false, reason: 'exists' }
      await this.write(wt, ['switch', '-c', safe])
      return { ok: true, branch: safe }
    } catch (err) {
      return { ok: false, reason: 'error', error: gitErrorMessage(err) }
    }
  }

  async handoffPreview(projectId: string, worktreePath: string): Promise<HandoffPreview | null> {
    try {
      const diff = await this.buildHandoffDiff(projectId, worktreePath)
      if (diff.ok) return diff.stat
      return diff.reason === 'not-worktree' ? null : { files: 0, insertions: 0, deletions: 0 }
    } catch {
      return null
    }
  }

  async handoffToMain(projectId: string, worktreePath: string): Promise<HandoffResult> {
    try {
      const diff = await this.buildHandoffDiff(projectId, worktreePath)
      if (!diff.ok) return { ok: false, reason: diff.reason }

      // Clean-check → apply → rollback must not interleave with another
      // mutation of main: a failed apply's reset --hard / clean -fd would wipe
      // a concurrent handoff (or a carry stash) that just landed.
      return await withRepoLock(diff.mainDir, async (): Promise<HandoffResult> => {
        const mainStatus = (await this.read(diff.mainDir, ['status', '--porcelain'])).trim()
        if (mainStatus) return { ok: false, reason: 'main-dirty' }

        const patch = await this.read(diff.worktreePath, ['diff', '--binary', diff.base, diff.tree])
        const patchFile = join(tmpdir(), `s1-handoff-${randomUUID()}.patch`)
        writeFileSync(patchFile, `${patch}\n`)
        // Narrow the TOCTOU window before mutating main; reset --hard on failure is only
        // safe if main was clean immediately before apply (not just at the first check).
        if ((await this.read(diff.mainDir, ['status', '--porcelain'])).trim()) {
          rmSync(patchFile, { force: true })
          return { ok: false, reason: 'main-dirty' }
        }
        try {
          await this.write(diff.mainDir, ['apply', '--3way', '--whitespace=nowarn', patchFile])
        } catch (err) {
          try {
            await this.write(diff.mainDir, ['reset', '--hard'])
            await this.write(diff.mainDir, ['clean', '-fd'])
          } catch {
            /* best-effort */
          }
          return { ok: false, reason: 'conflict', error: gitErrorMessage(err) }
        } finally {
          rmSync(patchFile, { force: true })
        }
        try {
          await this.write(diff.mainDir, ['reset', '--quiet'])
        } catch {
          /* ignore */
        }
        return { ok: true }
      })
    } catch (err) {
      return { ok: false, reason: 'error', error: gitErrorMessage(err) }
    }
  }

  private async buildHandoffDiff(
    projectId: string,
    worktreePath: string,
  ): Promise<
    | {
        ok: true
        mainDir: string
        worktreePath: string
        base: string
        tree: string
        stat: HandoffPreview
      }
    | { ok: false; reason: 'not-worktree' | 'no-changes' }
  > {
    const wt = await this.assertRepoWorktreePath(projectId, worktreePath)
    const mainDir = await this.resolveMainWorktreeDir(this.root(projectId))
    if (samePath(mainDir, wt)) return { ok: false, reason: 'not-worktree' }

    const onBranch = await this.isOnBranch(wt)
    const worktreeHead = (await this.read(wt, ['rev-parse', 'HEAD'])).trim()
    const tree = await this.writeWorkingTree(wt)

    let base = worktreeHead
    if (!onBranch) {
      const mainHead = (await this.read(mainDir, ['rev-parse', 'HEAD'])).trim()
      try {
        base = (await this.read(wt, ['merge-base', mainHead, worktreeHead])).trim() || worktreeHead
      } catch {
        base = worktreeHead
      }
    }

    const numstat = await this.read(wt, ['diff', '--numstat', base, tree])
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

  private async writeWorkingTree(worktreePath: string): Promise<string> {
    const tmpIndex = join(tmpdir(), `s1-handoff-${randomUUID()}.index`)
    const env = { GIT_INDEX_FILE: tmpIndex }
    try {
      await this.write(worktreePath, ['read-tree', 'HEAD'], env)
      await this.write(worktreePath, ['add', '-A'], env)
      return (await this.write(worktreePath, ['write-tree'], env)).trim()
    } finally {
      rmSync(tmpIndex, { force: true })
    }
  }

  repoIdentity(projectId: string): string | null {
    return this.projects.get(projectId)?.repoIdentity ?? null
  }
}

/**
 * Parse `git status --porcelain=v1 -b` output into branch metadata + file lines.
 * Header examples:
 *   ## main
 *   ## main...origin/main [ahead 1, behind 2]
 *   ## HEAD (no branch)
 */
export function parseBranchPorcelain(raw: string): {
  branch: string | null
  ahead: number
  behind: number
  porcelain: string
} {
  const lines = raw.length === 0 ? [] : raw.split('\n')
  if (lines.length === 0 || !lines[0]!.startsWith('## ')) {
    return { branch: null, ahead: 0, behind: 0, porcelain: raw }
  }
  const header = lines[0]!.slice(3).trim()
  let branch: string | null = null
  if (header.startsWith('HEAD') || header.includes('(no branch)')) {
    branch = null
  } else {
    // Take the local ref before "..." (upstream) or first whitespace/bracket.
    const cut = header.split('...')[0] ?? header
    branch = cut.split(/\s+/)[0] || null
  }
  const aheadM = header.match(/ahead (\d+)/)
  const behindM = header.match(/behind (\d+)/)
  const ahead = aheadM ? Number(aheadM[1]) || 0 : 0
  const behind = behindM ? Number(behindM[1]) || 0 : 0
  const porcelain = lines.slice(1).join('\n')
  return { branch, ahead, behind, porcelain }
}
