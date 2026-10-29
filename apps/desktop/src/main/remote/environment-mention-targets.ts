import { buildEnvironmentMentionCandidates, type EnvironmentMentionCandidate } from '@superone/shared/environment-mention'
import { getEnvironmentHost } from '../environment/environment-host'

/** The `@env` catalog a paired phone asks for: this machine, remote nodes, and other desktops. */
export async function readEnvironmentMentionTargets(): Promise<EnvironmentMentionCandidate[]> {
  const items = await getEnvironmentHost().listEnvironments({ includeDescriptors: true })
  return buildEnvironmentMentionCandidates({
    environments: items.map((item) => ({
      kind: item.kind,
      environmentId: item.environmentId,
      label: item.label,
      installationProfile: item.installationProfile,
      state: item.state,
      desired: item.desired,
      nodeUpgrade: item.nodeUpgrade,
    })),
  })
}
