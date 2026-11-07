import { buildEnvironmentMentionCandidates, type EnvironmentMentionCandidate } from '@superone/shared/environment-mention'
import { loadMentionCatalog } from './mention-catalog'
import { parseRemoteProjectKey } from './remote-project-key'
import { loadEnvironmentItems } from './environment-list'

const labelsByHost = new Map<string, readonly string[]>()
const hostKey = (projectPath?: string | null) => projectPath ? parseRemoteProjectKey(projectPath)?.connectionId ?? 'local' : 'local'

/** Labels from the last catalog load. The composer uses them to keep `@Mac mini` open. */
export function cachedEnvironmentMentionLabels(projectPath?: string | null): readonly string[] {
  return labelsByHost.get(hostKey(projectPath)) ?? []
}

/**
 * This machine, remote nodes, and other desktops the composer can @-mention.
 * A missing catalog (old preload, story without the IPC) is an empty list.
 */
export async function loadEnvironmentMentionCandidates(projectPath?: string | null): Promise<EnvironmentMentionCandidate[]> {
  if (projectPath) {
    const rows = (await loadMentionCatalog(projectPath)).environments ?? []
    labelsByHost.set(hostKey(projectPath), rows.map(row => row.label))
    return rows
  }
  const environments = await loadEnvironmentItems().catch(() => [])
  const rows = buildEnvironmentMentionCandidates({
    environments: Array.isArray(environments) ? environments : [],
  })
  labelsByHost.set(hostKey(projectPath), rows.map(row => row.label))
  return rows
}
