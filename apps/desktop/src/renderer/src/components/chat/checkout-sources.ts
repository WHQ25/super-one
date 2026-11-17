import type { CheckoutSource, CheckoutSourceBranch, CheckoutSourceBranchesResult, CheckoutSourcesInfo } from '@superone/shared/agent-types'
import { normalizeGitRemoteUrl, repoIdentityRemote } from '@superone/shared/git-remote-url'
import type { EnvironmentBucket, EnvironmentKind } from '@/lib/multi-host/types'
import type { NodeLinkPath } from '@superone/shared/environment/node-route'

export type CheckoutSourceGroup = 'node' | 'remote' | 'pr'

export interface CheckoutSourceOption {
  id: string
  group: CheckoutSourceGroup
  source: CheckoutSource
  label: string
  /** Remote URL, for git remotes. */
  detail?: string
  disabled?: 'offline' | 'needs-upgrade' | 'gh-unavailable'
  hostKind?: EnvironmentKind
  path?: NodeLinkPath
}

type BucketSource = Pick<EnvironmentBucket, 'environmentId' | 'connectionId' | 'label' | 'connection' | 'checkouts'> & {
  kind?: EnvironmentKind
  path?: NodeLinkPath
}

export function checkoutSourceId(source: CheckoutSource): string {
  if (source.kind === 'node') return `node:${source.connectionId}`
  if (source.kind === 'remote') return `remote:${source.remote}`
  return 'pr'
}

/**
 * Where a checkout can take a branch from: every other environment (this
 * computer included) with a checkout of the same origin, plus, for this
 * computer's checkouts (`info` given), the git remotes and pull requests.
 */
export function checkoutSourceOptions(input: {
  buckets: BucketSource[]
  /** The environment the checkout is on (`local` for this computer). */
  currentConnectionId: string
  repoIdentity: string | null
  info: CheckoutSourcesInfo | null
  pullRequestsLabel: string
}): CheckoutSourceOption[] {
  const options: CheckoutSourceOption[] = []
  const origin = repoIdentityRemote(input.repoIdentity)
  if (origin) {
    for (const bucket of input.buckets) {
      if (bucket.connectionId === input.currentConnectionId) continue
      const checkout = bucket.checkouts.find((item) => repoIdentityRemote(item.repoIdentity) === origin)
      if (!checkout) continue
      const source: CheckoutSource = { kind: 'node', connectionId: bucket.connectionId, folderPath: checkout.pathKey }
      options.push({
        id: checkoutSourceId(source),
        group: 'node',
        source,
        label: bucket.label,
        ...(bucket.connection === 'offline' ? { disabled: 'offline' as const } : {}),
        ...(bucket.connection === 'needs-upgrade' ? { disabled: 'needs-upgrade' as const } : {}),
        ...(bucket.kind ? { hostKind: bucket.kind } : {}),
        ...(bucket.path ? { path: bucket.path } : {}),
      })
    }
  }
  for (const remote of input.info?.remotes ?? []) {
    const source: CheckoutSource = { kind: 'remote', remote: remote.name }
    options.push({
      id: checkoutSourceId(source),
      group: 'remote',
      source,
      label: remote.name,
      detail: normalizeGitRemoteUrl(remote.url) ?? remote.url,
    })
  }
  if (input.info?.remotes.length) {
    options.push({
      id: 'pr',
      group: 'pr',
      source: { kind: 'pr' },
      label: input.pullRequestsLabel,
      ...(input.info.github ? {} : { disabled: 'gh-unavailable' as const }),
    })
  }
  return options
}

/** The label a local branch's recorded source shows: the environment, remote, or `#<number>`. */
export function sourceBadgeLabel(source: CheckoutSource, ref: string, options: CheckoutSourceOption[]): string {
  if (source.kind === 'pr') return `#${ref}`
  if (source.kind === 'remote') return source.remote
  return options.find((option) => option.id === checkoutSourceId(source))?.label ?? source.connectionId
}

const LAST_SOURCE_KEY = 'superone.checkoutSource:'

/** The last source used for this repository, else the first one that works. */
export function preferredCheckoutSource(folderPath: string, options: CheckoutSourceOption[]): CheckoutSourceOption | null {
  let saved: string | null = null
  try {
    saved = window.localStorage.getItem(LAST_SOURCE_KEY + folderPath)
  } catch {
    // Storage may be unavailable; fall back to the first usable source.
  }
  return options.find((option) => option.id === saved && !option.disabled)
    ?? options.find((option) => !option.disabled)
    ?? null
}

export function rememberCheckoutSource(folderPath: string, id: string): void {
  try {
    window.localStorage.setItem(LAST_SOURCE_KEY + folderPath, id)
  } catch {
    // Remembering is a convenience only.
  }
}

/** A git remote fetched longer ago than this is refreshed before its branches are shown. */
const REMOTE_STALE_MS = 5 * 60_000

/**
 * Branches from one source. A git remote shows its last fetch immediately and
 * fetches again when that fetch is stale.
 */
export async function readCheckoutSourceBranches(
  folderPath: string,
  option: CheckoutSourceOption,
): Promise<CheckoutSourceBranchesResult> {
  const read = (fetch: boolean) => window.app.listCheckoutSourceBranches(
    folderPath, option.source, fetch ? { fetch: true } : undefined,
  )
  const cached = await read(false)
  const fresh = cached.ok && !!cached.fetchedAt && Date.now() - cached.fetchedAt < REMOTE_STALE_MS
  if (option.group !== 'remote' || fresh || (!cached.ok && cached.reason !== 'error')) return cached
  const fetched = await read(true)
  return fetched.ok || !cached.ok ? fetched : cached
}

/**
 * Rows added beside this checkout's own branches.
 *
 * A git remote is listed only when this checkout has no branch of that name,
 * so it can sit in the same list and be checked out directly. A pull request
 * is its own tip, so it stays even when a local branch wears the same name.
 * Another environment keeps every branch that is not already identical,
 * because syncing or resolving it takes more than a checkout.
 */
export function branchesForUnifiedList(
  option: CheckoutSourceOption,
  branches: readonly CheckoutSourceBranch[],
  localNames: ReadonlySet<string>,
): CheckoutSourceBranch[] {
  if (option.group === 'pr') return [...branches]
  if (option.group === 'node') return branches.filter((branch) => branch.relation !== 'same')
  return branches.filter((branch) => branch.relation === 'new' && !localNames.has(branch.localName))
}
