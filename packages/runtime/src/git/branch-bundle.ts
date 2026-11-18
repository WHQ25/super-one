/**
 * Checkout sources: bring a branch from another place into a local branch.
 * Between two machines' clones there is no shared remote: the source writes an
 * incremental `git bundle` of a branch (plus an optional WIP snapshot commit of
 * uncommitted work) and the receiver unbundles it. Every source then lands
 * through {@link applyIncomingBranch}. See `docs/features/checkout-sources.md`.
 */

import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { BranchImportConflictMode, BranchImportResult, BranchRelation, BranchTip, GitBundleExportResult } from '@superone/shared/agent-types'
import { gitErrorMessage, sanitizeGitRef } from './sanitize-ref'
import { parseWorktreePorcelain } from './worktree-porcelain'
import { parseShortstat } from './shortstat'
import { withRepoLock } from './repo-lock'
import { writeWorkingTree, type WorktreeGit } from './worktree-ops'

/** Trailer marking a WIP snapshot commit, so the next import may replace it. */
export const SNAPSHOT_TRAILER = 'SuperOne-Snapshot'
/** Branch tips the receiver offers when no common ancestor can be walked. */
export const MAX_BUNDLE_HAVES = 512
/**
 * One page of `git rev-list` while walking a branch toward a commit the
 * receiver already has. Small enough to pass as git arguments.
 */
export const ANCESTRY_PAGE = 512
/** Stop the walk after this many pages; beyond it the bundle carries the whole branch. */
export const MAX_ANCESTRY_PAGES = 200
/** The receiver reads the bundle right away; nothing should outlive a slow transfer. */
const BUNDLE_TTL_MS = 30 * 60_000

const OBJECT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/

export function validObjectIds(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const ids = new Set<string>()
  for (const value of values) {
    if (typeof value === 'string' && OBJECT_ID.test(value)) ids.add(value)
    if (ids.size >= MAX_BUNDLE_HAVES) break
  }
  return [...ids]
}

/** Tips of the receiver's branches and remote-tracking refs, offered as `haves`. */
export async function readBundleHaves(git: WorktreeGit, repoPath: string): Promise<string[]> {
  const out = await git.read(repoPath, ['for-each-ref', '--format=%(objectname)', 'refs/heads', 'refs/remotes'])
  return validObjectIds(out.split('\n').map((line) => line.trim()))
}

function objectIds(text: string): string[] {
  return text.split('\n').map((line) => line.trim()).filter((line) => OBJECT_ID.test(line))
}

/**
 * Newest-first commits on `branch`, one page at a time. Walking back from the
 * tip lets a receiver that has moved past the sender's refs still name a
 * shared ancestor.
 */
export async function readAncestryPage(
  git: WorktreeGit,
  repoPath: string,
  branch: string,
  skip: number,
  maxCount: number,
): Promise<string[]> {
  const name = sanitizeGitRef(branch)
  const count = Number.isSafeInteger(maxCount) ? Math.min(Math.max(maxCount, 0), ANCESTRY_PAGE) : 0
  const skipN = Number.isSafeInteger(skip) && skip >= 0 ? skip : 0
  if (!count || skipN > ANCESTRY_PAGE * MAX_ANCESTRY_PAGES) return []
  const out = await git.read(repoPath, ['rev-list', `--max-count=${count}`, `--skip=${skipN}`, `refs/heads/${name}`])
  return objectIds(out)
}

/** The subset of `commits` this repository actually has. */
export async function presentCommits(git: WorktreeGit, repoPath: string, commits: readonly string[]): Promise<string[]> {
  const ids = commits.filter((commit) => OBJECT_ID.test(commit)).slice(0, ANCESTRY_PAGE)
  if (!ids.length) return []
  return objectIds(await git.read(repoPath, ['rev-list', '--no-walk', '--ignore-missing', ...ids]))
}

/** First commit of a newest-first list that the receiver has. */
export function newestHave(newestFirst: readonly string[], present: readonly string[]): string | null {
  const have = new Set(present)
  return newestFirst.find((commit) => have.has(commit)) ?? null
}

/**
 * Newest commit on the sender's branch that the receiver already has.
 * `null` from either side means the walk cannot run (an older node); an empty
 * page means the histories never meet.
 */
export async function findCommonAncestor(
  ancestry: (skip: number, maxCount: number) => Promise<string[] | null>,
  present: (commits: string[]) => Promise<string[] | null>,
): Promise<string | null> {
  for (let page = 0; page < MAX_ANCESTRY_PAGES; page++) {
    const commits = await ancestry(page * ANCESTRY_PAGE, ANCESTRY_PAGE)
    if (!commits?.length) return null
    const have = await present(commits)
    if (!have) return null
    const hit = newestHave(commits, have)
    if (hit) return hit
    if (commits.length < ANCESTRY_PAGE) return null
  }
  return null
}

async function snapshotIdentity(git: WorktreeGit, cwd: string): Promise<NodeJS.ProcessEnv> {
  const config = async (key: string) => (await git.read(cwd, ['config', key]).catch(() => '')).trim()
  const name = (await config('user.name')) || 'SuperOne'
  const email = (await config('user.email')) || 'superone@localhost'
  return { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email }
}

/** A WIP commit of the working tree on top of HEAD; null when nothing is uncommitted. */
async function snapshotCommit(git: WorktreeGit, cwd: string, head: string, branch: string): Promise<string | null> {
  const [tree, headTree] = await Promise.all([
    writeWorkingTree(git, cwd),
    git.read(cwd, ['rev-parse', `${head}^{tree}`]).then((s) => s.trim()),
  ])
  if (tree === headTree) return null
  const message = `WIP: uncommitted changes on ${branch}\n\n${SNAPSHOT_TRAILER}: ${head}`
  return (await git.read(cwd, ['commit-tree', tree, '-p', head, '-m', message], await snapshotIdentity(git, cwd))).trim()
}

export async function exportBranchBundle(
  git: WorktreeGit,
  cwd: string,
  input: { haves: string[]; includeWorkingTree: boolean; branch?: string },
): Promise<GitBundleExportResult> {
  const checkedOut = await git.read(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']).then((s) => s.trim(), () => '')
  let branch = checkedOut
  if (input.branch) {
    try {
      branch = sanitizeGitRef(input.branch)
    } catch (err) {
      return { ok: false, reason: 'error', error: gitErrorMessage(err) }
    }
  }
  if (!branch) return { ok: false, reason: 'detached' }
  const head = await git.read(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`]).then((s) => s.trim(), () => '')
  if (!head) return input.branch ? { ok: false, reason: 'error', error: `branch ${branch} not found` } : { ok: false, reason: 'no-commits' }
  try {
    // Only the checkout that has the branch can carry its uncommitted work.
    const snapshot = input.includeWorkingTree && branch === checkedOut ? await snapshotCommit(git, cwd, head, branch) : null
    const requested = validObjectIds(input.haves)
    // Only commits this repository has can bound the bundle.
    const haves = requested.length
      ? (await git.read(cwd, ['rev-list', '--no-walk', '--ignore-missing', ...requested]))
        .split('\n').map((s) => s.trim()).filter(Boolean)
      : []
    const tips = snapshot ? [head, snapshot] : [head]
    const missing = Number((await git.read(cwd, ['rev-list', '--count', ...tips, '--not', ...haves])).trim())
    if (!missing) return { ok: true, branch, head, snapshot, bundlePath: null, size: 0 }

    const dir = mkdtempSync(join(tmpdir(), 'superone-bundle-'))
    setTimeout(() => rmSync(dir, { recursive: true, force: true }), BUNDLE_TTL_MS).unref?.()
    const bundlePath = join(dir, 'branch.bundle')
    // A bundle only carries named refs; the snapshot gets a throwaway one.
    const snapshotRef = snapshot ? `refs/superone/export/${randomUUID()}` : null
    try {
      if (snapshotRef) await git.write(cwd, ['update-ref', snapshotRef, snapshot!])
      await git.write(cwd, [
        'bundle', 'create', bundlePath,
        `refs/heads/${branch}`, ...(snapshotRef ? [snapshotRef] : []),
        ...(haves.length ? ['--not', ...haves] : []),
      ])
    } catch (err) {
      rmSync(dir, { recursive: true, force: true })
      throw err
    } finally {
      if (snapshotRef) await git.write(cwd, ['update-ref', '-d', snapshotRef]).catch(() => {})
    }
    return { ok: true, branch, head, snapshot, bundlePath, size: statSync(bundlePath).size }
  } catch (err) {
    return { ok: false, reason: 'error', error: gitErrorMessage(err) }
  }
}

async function isAncestor(git: WorktreeGit, cwd: string, ancestor: string, descendant: string): Promise<boolean> {
  return git.read(cwd, ['merge-base', '--is-ancestor', ancestor, descendant]).then(() => true, () => false)
}

/** Most recently committed local branches, with the worktree each is checked out in. */
export const MAX_BRANCH_TIPS = 100

export async function readBranchTips(git: WorktreeGit, cwd: string): Promise<BranchTip[]> {
  const out = await git.read(cwd, [
    'for-each-ref', '--sort=-committerdate', `--count=${MAX_BRANCH_TIPS}`,
    '--format=%(refname:short)%00%(objectname)%00%(worktreepath)', 'refs/heads',
  ])
  return out.split('\n').filter(Boolean).map((line) => {
    const [name = '', head = '', worktreePath = ''] = line.split('\0')
    return { name, head, ...(worktreePath ? { worktreePath } : {}) }
  }).filter((tip) => tip.name && OBJECT_ID.test(tip.head))
}

/** Worktrees whose status {@link readBranchTipsWithChanges} reads; each is a `git status`. */
const MAX_DIRTY_PROBES = 16

/** {@link readBranchTips}, plus the uncommitted work of the checkouts that have them. */
export async function readBranchTipsWithChanges(git: WorktreeGit, root: string): Promise<BranchTip[]> {
  const tips = await readBranchTips(git, root)
  let probes = 0
  return Promise.all(tips.map(async (tip): Promise<BranchTip> => {
    if (!tip.worktreePath || probes++ >= MAX_DIRTY_PROBES) return tip
    const porcelain = await git.read(tip.worktreePath, ['status', '--porcelain']).catch(() => '')
    const files = porcelain.split('\n').filter(Boolean).length
    if (!files) return tip
    const stat = parseShortstat(await git.read(tip.worktreePath, ['diff', 'HEAD', '--shortstat']).catch(() => ''))
    return { ...tip, dirty: { files, ...stat } }
  }))
}

/** The checkout that has `branch` checked out, else the repository root. */
export async function checkoutHolding(git: WorktreeGit, root: string, branch: string): Promise<string> {
  const listed = parseWorktreePorcelain(await git.read(root, ['worktree', 'list', '--porcelain']).catch(() => ''))
  return listed.find((entry) => entry.branch === branch && !entry.bare)?.path ?? root
}

/**
 * Where each incoming tip stands against the local branch it would land on.
 * `behind` and `ahead` count the commits between that branch and the tip.
 * `update`: the tip is not in this repository yet, so only an import can tell.
 */
export async function branchRelations(
  git: WorktreeGit,
  repoPath: string,
  items: ReadonlyArray<{ localName: string; head: string }>,
): Promise<Array<{ relation: BranchRelation; behind?: number; ahead?: number }>> {
  const locals = new Map<string, string>()
  const out = await git.read(repoPath, ['for-each-ref', '--format=%(refname:short)%00%(objectname)', 'refs/heads'])
  for (const line of out.split('\n')) {
    const [name, head] = line.split('\0')
    if (name && head) locals.set(name, head)
  }
  const heads = validObjectIds(items.map((item) => item.head))
  const present = new Set(heads.length
    ? (await git.read(repoPath, ['rev-list', '--no-walk', '--ignore-missing', ...heads])).split('\n').map((s) => s.trim())
    : [])
  return Promise.all(items.map(async ({ localName, head }) => {
    const old = locals.get(localName)
    if (!old) return { relation: 'new' as const }
    if (old === head) return { relation: 'same' as const }
    if (!present.has(head)) return { relation: 'update' as const }
    if (await isAncestor(git, repoPath, old, head)) {
      const behind = Number((await git.read(repoPath, ['rev-list', '--count', `${old}..${head}`])).trim()) || undefined
      return { relation: 'behind' as const, ...(behind ? { behind } : {}) }
    }
    if (await isAncestor(git, repoPath, head, old)) {
      const ahead = Number((await git.read(repoPath, ['rev-list', '--count', `${head}..${old}`])).trim()) || undefined
      return { relation: 'ahead' as const, ...(ahead ? { ahead } : {}) }
    }
    return { relation: 'diverged' as const }
  }))
}

/** An earlier import's WIP snapshot whose base the incoming tip still contains. */
async function isStaleSnapshot(git: WorktreeGit, cwd: string, old: string, target: string): Promise<boolean> {
  const body = await git.read(cwd, ['log', '-1', '--format=%B', old]).catch(() => '')
  if (!new RegExp(`^${SNAPSHOT_TRAILER}: `, 'm').test(body)) return false
  return isAncestor(git, cwd, `${old}^`, target)
}

export interface IncomingBranchInput {
  /** Local copy of an exported bundle; null when the objects are already here (fetched, or not needed). */
  bundlePath: string | null
  /** Local branch that receives the tip. */
  localName: string
  head: string
  snapshot: string | null
  onDiverged?: BranchImportConflictMode
  /** "Save as": refuse a name that already exists. */
  createOnly?: boolean
}

/**
 * Create or move a local branch to an incoming tip (any checkout source).
 * Never clobbers another checkout's uncommitted changes.
 */
export async function applyIncomingBranch(
  git: WorktreeGit,
  repoPath: string,
  input: IncomingBranchInput,
): Promise<BranchImportResult> {
  let name: string
  try {
    name = sanitizeGitRef(input.localName.trim())
  } catch (err) {
    return { ok: false, reason: 'error', error: gitErrorMessage(err) }
  }
  // The exporting host names these commits; they reach git only as object ids.
  if (!OBJECT_ID.test(input.head) || (input.snapshot !== null && !OBJECT_ID.test(input.snapshot))) {
    return { ok: false, reason: 'error', error: 'invalid commit id' }
  }
  // Ref moves and `reset --keep` queue with this host's other repository mutations.
  return withRepoLock(repoPath, () => landIncoming(git, repoPath, name, input))
}

async function landIncoming(git: WorktreeGit, repoPath: string, name: string, input: IncomingBranchInput): Promise<BranchImportResult> {
  try {
    if (input.bundlePath) {
      // Untimed: a first import of a large history can take a while to check.
      await git.write(repoPath, ['bundle', 'verify', '--quiet', input.bundlePath])
      await git.write(repoPath, ['bundle', 'unbundle', input.bundlePath])
    }
    const target = input.snapshot ?? input.head
    await git.read(repoPath, ['cat-file', '-e', `${target}^{commit}`])

    const ref = `refs/heads/${name}`
    const old = await git.read(repoPath, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).then((s) => s.trim(), () => '')
    const done = (status: 'created' | 'updated' | 'unchanged', backupBranch?: string): BranchImportResult => ({
      ok: true, branch: name, head: target, status, snapshot: !!input.snapshot, ...(backupBranch ? { backupBranch } : {}),
    })
    if (old === target) return done('unchanged')
    // "Save as" only ever creates a branch.
    if (old && input.createOnly) return { ok: false, reason: 'exists', branch: name }

    let backupBranch: string | undefined
    if (old && !(await isAncestor(git, repoPath, old, target)) && !(await isStaleSnapshot(git, repoPath, old, target))) {
      if (input.onDiverged !== 'overwrite') return { ok: false, reason: 'diverged', branch: name }
      backupBranch = `superone-backup/${name}/${old.slice(0, 7)}`
      await git.write(repoPath, ['update-ref', `refs/heads/${backupBranch}`, old])
    }

    const listed = parseWorktreePorcelain(await git.read(repoPath, ['worktree', 'list', '--porcelain']))
    const checkout = listed.find((entry) => entry.branch === name)
    if (checkout) {
      // Moves HEAD with the files; refuses instead of clobbering local edits.
      try {
        await git.write(checkout.path, ['reset', '--keep', target])
      } catch (err) {
        return { ok: false, reason: 'conflict', branch: name, error: gitErrorMessage(err) }
      }
    } else {
      await git.write(repoPath, ['update-ref', ref, target, old])
    }
    return done(old ? 'updated' : 'created', backupBranch)
  } catch (err) {
    return { ok: false, reason: 'error', branch: name, error: gitErrorMessage(err) }
  }
}
