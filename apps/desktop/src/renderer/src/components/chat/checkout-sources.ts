import type { CheckoutSource, CheckoutSourcesInfo } from '@superone/shared/agent-types'
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
