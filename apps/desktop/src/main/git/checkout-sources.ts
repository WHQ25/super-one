/**
 * Checkout sources: land a branch from somewhere else into a repository. The
 * origin is an environment's checkout (this computer or a node), a git
 * remote, or a GitHub pull request; the target is this computer's checkout or
 * a node's. Between environments there is no shared remote: the origin
 * bundles what the target lacks and this desktop relays the bundle. Every
 * target lands through `applyIncomingBranch`. See `docs/features/checkout-sources.md`.
 */
import { rmSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  applyIncomingBranch,
  branchRelations,
  checkoutHolding,
  exportBranchBundle,
  fetchRemoteCommands,
  findCommonAncestor,
  gitErrorMessage,
  isGhMissingError,
  isGitRemoteName,
  presentCommits,
  readAncestryPage,
  readBranchTipsWithChanges,
  readBundleHaves,
  type WorktreeGit,
} from '@superone/runtime/git'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import type {
  BranchImportConflictMode,
  BranchImportResult,
  BranchRelation,
  BranchTip,
  CheckoutFromSourceRequest,
  CheckoutSource,
  CheckoutSourceBranch,
  CheckoutSourceBranchesResult,
  CheckoutSourcesInfo,
  LocalBranchSource,
} from '@superone/shared/agent-types'
import type { NodeBranchBundle, TransferControl } from '../environment/remote-worktree'

type Relation = { relation: BranchRelation; behind?: number; ahead?: number }
type Incoming = Pick<NodeBranchBundle, 'bundlePath' | 'head' | 'snapshot'> & {
  localName: string
  onDiverged?: BranchImportConflictMode
  createOnly?: boolean
}

export interface CheckoutSourceDeps {
  git: WorktreeGit
  gh(cwd: string, args: string[]): Promise<string>
  /** Whether the repository's origin is a GitHub repository `gh` can read. */
  github(folderPath: string): Promise<boolean>
  /** Node checkouts, by project key, as origins and as targets. */
  node: {
    branchTips(folderPath: string): Promise<{ ok: true; branches: BranchTip[] } | { ok: false; reason: 'unsupported' | 'unavailable' | 'error'; error?: string }>
    withBundle(
      input: { folderPath: string; branch: string; haves: string[]; includeWorkingTree: boolean },
      use: (bundle: NodeBranchBundle) => Promise<BranchImportResult>,
      control?: TransferControl,
    ): Promise<BranchImportResult>
    haves(folderPath: string): Promise<string[]>
    /** Newest-first page of a branch. `null` when the node cannot walk history. */
    revList(folderPath: string, branch: string, skip: number, maxCount: number): Promise<string[] | null>
    /** Which of `commits` the node has. `null` when the node cannot answer. */
    present(folderPath: string, commits: string[]): Promise<string[] | null>
    relations(folderPath: string, items: Array<{ localName: string; head: string }>): Promise<Relation[]>
    land(folderPath: string, incoming: Incoming, control?: TransferControl): Promise<BranchImportResult>
  }
}

/** Where a branch comes from when it lives in an environment's checkout. */
interface BranchOrigin {
  tips(): Promise<BranchTip[]>
  withBundle(
    input: { branch: string; haves: string[]; includeWorkingTree: boolean },
    use: (bundle: NodeBranchBundle) => Promise<BranchImportResult>,
    control: TransferControl,
  ): Promise<BranchImportResult>
}

/** Where a branch lands. */
interface BranchTarget {
  /** This computer's checkout: git remotes and pull requests can feed it, and it records sources. */
  local: boolean
  haves(): Promise<string[]>
  relations(items: Array<{ localName: string; head: string }>): Promise<Relation[]>
  land(incoming: Incoming, control: TransferControl): Promise<BranchImportResult>
}

function failure(reason: 'unsupported' | 'unavailable' | 'error', error?: string): Error {
  return Object.assign(new Error(error ?? reason), { code: reason })
}

function environmentOrigin(deps: CheckoutSourceDeps, source: Extract<CheckoutSource, { kind: 'node' }>): BranchOrigin {
  if (source.connectionId !== 'local') {
    return {
      tips: async () => {
        const tips = await deps.node.branchTips(source.folderPath)
        if (!tips.ok) throw failure(tips.reason, tips.error)
        return tips.branches
      },
      withBundle: (input, use, control) => deps.node.withBundle({ ...input, folderPath: source.folderPath }, use, control),
    }
  }
  const root = source.folderPath
  return {
    tips: () => readBranchTipsWithChanges(deps.git, root),
    withBundle: async (input, use, control) => {
      control.onProgress?.('bundling')
      const cwd = await checkoutHolding(deps.git, root, input.branch)
      const exported = await exportBranchBundle(deps.git, cwd, input)
      if (!exported.ok) return { ok: false, reason: exported.reason, error: exported.error }
      try {
        return await use(exported)
      } finally {
        if (exported.bundlePath) rmSync(dirname(exported.bundlePath), { recursive: true, force: true })
      }
    },
  }
}

function targetFor(deps: CheckoutSourceDeps, folderPath: string): BranchTarget {
  if (parseRemoteProjectKey(folderPath)) {
    return {
      local: false,
      haves: () => deps.node.haves(folderPath),
      relations: (items) => deps.node.relations(folderPath, items),
      land: (incoming, control) => deps.node.land(folderPath, incoming, control),
    }
  }
  return {
    local: true,
    haves: () => readBundleHaves(deps.git, folderPath),
    relations: (items) => branchRelations(deps.git, folderPath, items),
    land: (incoming, control) => {
      control.onProgress?.('applying')
      return applyIncomingBranch(deps.git, folderPath, incoming)
    },
  }
}

/** Rows a source lists; the newest first. */
const MAX_SOURCE_BRANCHES = 100
/** `branch.<name>.<key>`: the node or pull request a branch was checked out from. */
const SOURCE_CONFIG_KEY = 'superoneSource'

type SourceItem = Omit<CheckoutSourceBranch, 'relation' | 'behind'>

export async function checkoutSourcesInfo(deps: CheckoutSourceDeps, folderPath: string): Promise<CheckoutSourcesInfo> {
  const out = await deps.git.read(folderPath, ['config', '--get-regexp', '^remote\\..*\\.url$']).catch(() => '')
  const remotes = out.split('\n').filter(Boolean).map((line) => {
    const space = line.indexOf(' ')
    const key = line.slice(0, space)
    return { name: key.slice('remote.'.length, -'.url'.length), url: line.slice(space + 1) }
  }).filter((remote) => isGitRemoteName(remote.name))
  const github = remotes.length > 0 && await deps.github(folderPath).catch(() => false)
  return { remotes, github }
}

/** When `remote` was last fetched: the mtime of FETCH_HEAD, which every fetch rewrites. */
async function lastFetchedAt(git: WorktreeGit, folderPath: string): Promise<number | undefined> {
  try {
    const path = (await git.read(folderPath, ['rev-parse', '--git-path', 'FETCH_HEAD'])).trim()
    return statSync(resolve(folderPath, path)).mtimeMs
  } catch {
    return undefined
  }
}

async function remoteItems(deps: CheckoutSourceDeps, folderPath: string, remote: string, fetch: boolean): Promise<SourceItem[]> {
  if (fetch) await deps.git.write(folderPath, fetchRemoteCommands(remote).fetch)
  const prefix = `refs/remotes/${remote}/`
  const out = await deps.git.read(folderPath, [
    'for-each-ref', '--sort=-committerdate', `--count=${MAX_SOURCE_BRANCHES + 1}`,
    '--format=%(refname)%00%(objectname)%00%(committerdate:unix)', prefix,
  ])
  return out.split('\n').filter(Boolean).map((line) => line.split('\0')).flatMap(([ref = '', head = '', at = '']) => {
    const name = ref.slice(prefix.length)
    if (!name || name === 'HEAD') return []
    return [{ ref: name, title: `${remote}/${name}`, head, localName: name, updatedAt: Number(at) * 1000 }]
  }).slice(0, MAX_SOURCE_BRANCHES)
}

interface GhPull {
  number: number
  title: string
  headRefName: string
  headRefOid: string
  isCrossRepository?: boolean
  author?: { login?: string }
  updatedAt?: string
}

async function pullItems(deps: CheckoutSourceDeps, folderPath: string): Promise<SourceItem[]> {
  const raw = await deps.gh(folderPath, [
    'pr', 'list', '--state', 'open', '--limit', '50',
    '--json', 'number,title,headRefName,headRefOid,isCrossRepository,author,updatedAt',
  ])
  return (JSON.parse(raw || '[]') as GhPull[]).map((pr) => ({
    ref: String(pr.number),
    title: `#${pr.number} ${pr.title}`,
    detail: pr.author?.login ?? undefined,
    head: pr.headRefOid,
    // A fork's branch name may collide with one of ours.
    localName: pr.isCrossRepository ? `pr/${pr.number}-${pr.headRefName}` : pr.headRefName,
    ...(pr.isCrossRepository ? { fork: true } : {}),
    ...(pr.updatedAt ? { updatedAt: Date.parse(pr.updatedAt) } : {}),
  }))
}

function failureResult(err: unknown): Extract<CheckoutSourceBranchesResult, { ok: false }> {
  const code = (err as { code?: unknown }).code
  if (code === 'unsupported' || code === 'unavailable') return { ok: false, reason: code }
  return { ok: false, reason: 'error', error: gitErrorMessage(err) }
}

function sameCheckout(source: CheckoutSource, folderPath: string): boolean {
  return source.kind === 'node' && source.folderPath === folderPath
}

/**
 * A source's branches, classified against the target's. A git remote lists
 * its remote-tracking refs as of the last fetch unless `fetch` is set.
 */
export async function listSourceBranches(
  deps: CheckoutSourceDeps,
  folderPath: string,
  source: CheckoutSource,
  options: { fetch?: boolean } = {},
): Promise<CheckoutSourceBranchesResult> {
  const target = targetFor(deps, folderPath)
  if (sameCheckout(source, folderPath)) return { ok: false, reason: 'error', error: 'source and target are the same checkout' }
  if (source.kind !== 'node' && !target.local) return { ok: false, reason: 'unsupported' }
  try {
    let items: SourceItem[]
    let fetchedAt: number | undefined
    if (source.kind === 'node') {
      items = (await environmentOrigin(deps, source).tips()).map((tip) => ({
        ref: tip.name, title: tip.name, head: tip.head, localName: tip.name,
        ...(tip.worktreePath ? { checkedOut: true } : {}),
        ...(tip.dirty ? { dirty: tip.dirty } : {}),
      }))
    } else if (source.kind === 'remote') {
      if (!isGitRemoteName(source.remote)) return { ok: false, reason: 'error', error: 'invalid remote name' }
      items = await remoteItems(deps, folderPath, source.remote, options.fetch === true)
      fetchedAt = await lastFetchedAt(deps.git, folderPath)
    } else {
      items = await pullItems(deps, folderPath)
    }
    const relations = await target.relations(items)
    return {
      ok: true,
      branches: items.map((item, index) => ({ ...item, ...relations[index]! })),
      ...(fetchedAt ? { fetchedAt } : {}),
    }
  } catch (err) {
    if (source.kind === 'pr' && isGhMissingError(err)) return { ok: false, reason: 'unavailable' }
    return failureResult(err)
  }
}

async function hasCommit(git: WorktreeGit, folderPath: string, head: string): Promise<boolean> {
  return git.read(folderPath, ['cat-file', '-e', `${head}^{commit}`]).then(() => true, () => false)
}

/** The remote pull requests are fetched from: origin, else the only remote. */
async function pullRemote(deps: CheckoutSourceDeps, folderPath: string): Promise<string | null> {
  const { remotes } = await checkoutSourcesInfo({ ...deps, github: async () => false }, folderPath)
  return remotes.find((remote) => remote.name === 'origin')?.name ?? (remotes.length === 1 ? remotes[0]!.name : null)
}

async function recordSource(git: WorktreeGit, folderPath: string, branch: string, source: CheckoutSource, ref: string): Promise<void> {
  const key = `branch.${branch}.${SOURCE_CONFIG_KEY}`
  if (source.kind === 'remote') {
    // A remote branch tracks the ordinary way.
    await git.write(folderPath, ['branch', `--set-upstream-to=${source.remote}/${ref}`, branch]).catch(() => {})
    await git.write(folderPath, ['config', '--unset', key]).catch(() => {})
    return
  }
  await git.write(folderPath, ['config', key, JSON.stringify({ source, ref })]).catch(() => {})
}

const CANCELLED: BranchImportResult = { ok: false, reason: 'cancelled' }

/** Newest-first page of the origin branch, or null when that side cannot walk. */
async function sourceAncestry(
  deps: CheckoutSourceDeps,
  source: Extract<CheckoutSource, { kind: 'node' }>,
  branch: string,
  skip: number,
  maxCount: number,
): Promise<string[] | null> {
  if (source.connectionId !== 'local') return deps.node.revList(source.folderPath, branch, skip, maxCount)
  try {
    return await readAncestryPage(deps.git, source.folderPath, branch, skip, maxCount)
  } catch {
    return null
  }
}

/** Which of `commits` the target has, or null when that side cannot answer. */
function targetPresent(deps: CheckoutSourceDeps, folderPath: string, commits: string[]): Promise<string[] | null> {
  if (parseRemoteProjectKey(folderPath)) return deps.node.present(folderPath, commits)
  return presentCommits(deps.git, folderPath, commits)
}

/**
 * The newest commit of `branch` the target already has. Ref tips are the
 * fallback: they miss the ancestor when the target has moved past every
 * commit the origin still has.
 */
async function havesAgainstBranch(
  deps: CheckoutSourceDeps,
  source: Extract<CheckoutSource, { kind: 'node' }>,
  folderPath: string,
  branch: string,
): Promise<string[]> {
  const ancestor = await findCommonAncestor(
    (skip, maxCount) => sourceAncestry(deps, source, branch, skip, maxCount),
    (commits) => targetPresent(deps, folderPath, commits),
  )
  if (ancestor) return [ancestor]
  return targetFor(deps, folderPath).haves()
}

/**
 * Bring one branch from `request.source` into `request.folderPath`. Progress
 * goes to `control`; cancelling stops between transfer chunks and before the
 * target changes, never half way through landing.
 */
export async function checkoutFromSource(
  deps: CheckoutSourceDeps,
  request: CheckoutFromSourceRequest,
  control: TransferControl = {},
): Promise<BranchImportResult> {
  const { folderPath, source, branch } = request
  const target = targetFor(deps, folderPath)
  if (sameCheckout(source, folderPath)) return { ok: false, reason: 'error', error: 'source and target are the same checkout' }
  if (source.kind !== 'node' && !target.local) return { ok: false, reason: 'unsupported' }
  const landing = (incoming: Pick<NodeBranchBundle, 'bundlePath' | 'head' | 'snapshot'>): Promise<BranchImportResult> => {
    if (control.signal?.aborted) return Promise.resolve(CANCELLED)
    return target.land({
      bundlePath: incoming.bundlePath,
      head: incoming.head,
      snapshot: incoming.snapshot,
      localName: request.localName,
      ...(request.onDiverged ? { onDiverged: request.onDiverged } : {}),
      ...(request.createOnly ? { createOnly: true } : {}),
    }, control)
  }
  try {
    let result: BranchImportResult
    if (source.kind === 'node') {
      result = await environmentOrigin(deps, source).withBundle({
        branch: branch.ref,
        haves: await havesAgainstBranch(deps, source, folderPath, branch.ref),
        includeWorkingTree: request.includeWorkingTree === true,
      }, landing, control)
    } else {
      let fetch: string[]
      if (source.kind === 'remote') {
        if (!isGitRemoteName(source.remote)) return { ok: false, reason: 'error', error: 'invalid remote name' }
        fetch = fetchRemoteCommands(source.remote).fetch
      } else {
        const remote = await pullRemote(deps, folderPath)
        if (!remote || !/^\d+$/.test(branch.ref)) return { ok: false, reason: 'error', error: 'no remote to fetch the pull request from' }
        fetch = ['fetch', '--quiet', remote, `refs/pull/${branch.ref}/head`]
      }
      if (!(await hasCommit(deps.git, folderPath, branch.head))) {
        control.onProgress?.('fetching')
        await deps.git.write(folderPath, fetch)
      }
      result = await landing({ bundlePath: null, head: branch.head, snapshot: null })
    }
    // A node keeps no record: which environment a source names depends on the controller.
    if (result.ok && target.local) await recordSource(deps.git, folderPath, result.branch, source, branch.ref)
    return result
  } catch (err) {
    const code = (err as { code?: unknown }).code
    if (code === 'cancelled') return CANCELLED
    if (code === 'unsupported') return { ok: false, reason: 'unsupported' }
    return { ok: false, reason: 'error', error: gitErrorMessage(err) }
  }
}

function parseRecordedSource(raw: string): { source: CheckoutSource; ref: string } | null {
  try {
    const value = JSON.parse(raw) as { source?: CheckoutSource; ref?: unknown }
    const source = value.source
    if (typeof value.ref !== 'string' || !source) return null
    if (source.kind === 'node' && typeof source.connectionId === 'string' && typeof source.folderPath === 'string') {
      return { source: { kind: 'node', connectionId: source.connectionId, folderPath: source.folderPath }, ref: value.ref }
    }
    return source.kind === 'pr' ? { source: { kind: 'pr' }, ref: value.ref } : null
  } catch {
    return null
  }
}

/**
 * Local branches with a checkout source and where they stand against it. A
 * branch tracking a git remote is listed only when it is behind or diverged;
 * node and pull request branches always are.
 */
export async function localBranchSources(deps: CheckoutSourceDeps, folderPath: string): Promise<Record<string, LocalBranchSource>> {
  const sources: Record<string, LocalBranchSource> = {}
  if (!targetFor(deps, folderPath).local) return sources

  const upstreams = await deps.git.read(folderPath, [
    'for-each-ref', '--format=%(refname:short)%00%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream:track)%00%(upstream)',
    'refs/heads',
  ]).catch(() => '')
  const behindRefs: Array<{ branch: string; upstream: string }> = []
  for (const line of upstreams.split('\n')) {
    const [branch = '', remote = '', remoteRef = '', track = '', upstream = ''] = line.split('\0')
    const behind = Number(track.match(/behind (\d+)/)?.[1] ?? 0)
    if (!branch || !remote || !remoteRef.startsWith('refs/heads/') || !behind) continue
    sources[branch] = {
      source: { kind: 'remote', remote },
      ref: remoteRef.slice('refs/heads/'.length),
      relation: /ahead \d+/.test(track) ? 'diverged' : 'behind',
      behind,
    }
    behindRefs.push({ branch, upstream })
  }
  if (behindRefs.length) {
    const heads = (await deps.git.read(folderPath, ['rev-parse', ...behindRefs.map((r) => r.upstream)]).catch(() => '')).split('\n')
    behindRefs.forEach(({ branch }, index) => { if (heads[index]) sources[branch]!.head = heads[index]!.trim() })
  }

  const recorded = await deps.git.read(folderPath, ['config', '--get-regexp', `^branch\\..*\\.${SOURCE_CONFIG_KEY.toLowerCase()}$`]).catch(() => '')
  const nodeBranches = new Map<string, Array<{ branch: string; ref: string }>>()
  for (const line of recorded.split('\n')) {
    const space = line.indexOf(' ')
    if (space < 0) continue
    const key = line.slice(0, space)
    const branch = key.slice('branch.'.length, -(SOURCE_CONFIG_KEY.length + 1))
    const parsed = parseRecordedSource(line.slice(space + 1))
    if (!branch || !parsed) continue
    sources[branch] = { source: parsed.source, ref: parsed.ref }
    if (parsed.source.kind === 'node') {
      const list = nodeBranches.get(parsed.source.folderPath) ?? []
      list.push({ branch, ref: parsed.ref })
      nodeBranches.set(parsed.source.folderPath, list)
    }
  }

  await Promise.all([...nodeBranches].map(async ([nodeFolder, branches]) => {
    const tips = await deps.node.branchTips(nodeFolder).catch(() => null)
    if (!tips?.ok) return
    const byName = new Map(tips.branches.map((tip) => [tip.name, tip.head]))
    const known = branches.flatMap(({ branch, ref }) => {
      const head = byName.get(ref)
      return head ? [{ branch, localName: branch, head }] : []
    })
    const relations = await branchRelations(deps.git, folderPath, known)
    known.forEach(({ branch, head }, index) => {
      sources[branch] = { ...sources[branch]!, head, ...relations[index]! }
    })
  }))
  return sources
}
