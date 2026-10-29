import type { RelayClient } from '@superone/relay-client'
import {
  encodeEnvironmentMentionValue,
  filterEnvironmentMentions,
  type EnvironmentMentionCandidate,
  type EnvironmentMentionRole,
  type EnvironmentMentionStatus,
} from '@superone/shared/environment-mention'
import type { MentionItem } from './mentions'

const ROLES = new Set<EnvironmentMentionRole>(['local', 'cli-node', 'remote-desktop'])
const STATUSES = new Set<EnvironmentMentionStatus>(['connected', 'connecting', 'offline', 'needs-upgrade'])

function isCandidate(value: unknown): value is EnvironmentMentionCandidate {
  if (!value || typeof value !== 'object') return false
  const row = value as EnvironmentMentionCandidate
  return ROLES.has(row.role) && STATUSES.has(row.status) && typeof row.id === 'string' && typeof row.label === 'string'
}

function detail(row: EnvironmentMentionCandidate): string {
  const role = row.role === 'local' ? 'This machine' : row.role === 'remote-desktop' ? 'Remote desktop' : 'Remote node'
  const status = row.status === 'needs-upgrade' ? 'needs upgrade' : row.status
  return `${role} · ${status}`
}

/** Popup rows for one catalog. The encoded value is what the chip stores. */
export function environmentMentionItems(targets: readonly unknown[], nameQuery: string): MentionItem[] {
  const catalog = targets.filter(isCandidate)
  return filterEnvironmentMentions(catalog, nameQuery).flatMap((row) => {
    const path = encodeEnvironmentMentionValue(row.role, row.id)
    if (!path) return []
    return [{
      kind: 'environment',
      path,
      label: row.label,
      labelIndices: row.matchIndices,
      description: detail(row),
    }]
  })
}

let cachedLabels: readonly string[] = []

/** Labels from the last catalog fetch. A name with a space stays an @-query while it matches one. */
export function cachedEnvironmentMentionLabels(): readonly string[] {
  return cachedLabels
}

/** Empty catalog and a name that matches nothing are different sentences. */
export function environmentMentionEmptyLabel(catalogCount: number): string {
  return catalogCount === 0 ? 'No machines to mention' : 'No matching environments'
}

/** Ask the paired desktop for machines, then filter the name locally. */
export async function requestEnvironmentMentions(
  client: RelayClient,
  nameQuery: string,
): Promise<{ items: MentionItem[]; emptyLabel: string }> {
  const result = await client.rpc<{ targets?: unknown; error?: string }>('environment.mentionTargets', {})
  if (result && typeof result === 'object' && 'error' in result && result.error) throw new Error(result.error)
  const targets = Array.isArray(result?.targets) ? result.targets : []
  const items = environmentMentionItems(targets, '')
  cachedLabels = items.map((item) => item.label ?? '').filter(Boolean)
  const named = nameQuery.trim() ? environmentMentionItems(targets, nameQuery) : items
  return { items: named, emptyLabel: environmentMentionEmptyLabel(targets.filter(isCandidate).length) }
}
