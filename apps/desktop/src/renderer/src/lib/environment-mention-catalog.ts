import { buildEnvironmentMentionCandidates, type EnvironmentMentionCandidate } from '@superone/shared/environment-mention'
import { loadEnvironmentItems } from './environment-list'

let cachedLabels: readonly string[] = []

/** Labels from the last catalog load. The composer uses them to keep `@Mac mini` open. */
export function cachedEnvironmentMentionLabels(): readonly string[] {
  return cachedLabels
}

/**
 * This machine, remote nodes, and other desktops the composer can @-mention.
 * A missing catalog (old preload, story without the IPC) is an empty list.
 */
export async function loadEnvironmentMentionCandidates(): Promise<EnvironmentMentionCandidate[]> {
  const environments = await loadEnvironmentItems().catch(() => [])
  const rows = buildEnvironmentMentionCandidates({
    environments: Array.isArray(environments) ? environments : [],
  })
  cachedLabels = rows.map((row) => row.label)
  return rows
}
