import { AGENT_PROFILE_VERSION, profileApprovalConfig, providerLaunchRuntime, readAgentProfile, type AgentProfileCatalog } from '@superone/shared/agent-profile'
import type { AgentProfileManagementDetail, ManagedAgentProfile, SaveManagedAgentProfile } from '@superone/shared/agent-profile-management'
import { parseManagedProfileDraft } from '@superone/shared/agent-profile-management'
import { isDefaultSessionProvider } from '@superone/shared/session-provider-definitions'
import { getDb } from '../database'
import { approveAgentProfile, configFingerprint, isAgentProfileApproved, selectedApprovalProvider } from './agent-profile-approval'
import { agentProfileCatalog, createAgentProfile, deleteAgentProfile, updateAgentProfile } from './agent-profile-store'
import { agentProfileLaunchConfig, isProviderUsable, sessionAgentProfile } from './agent-profiles'
import { getSessionProvider, listSessionProviders } from './session-provider-repo'
import type { SessionProvider } from './types'
import type { SessionManagerImpl } from './session-manager'
import { assertAgentProfilesEnabled } from './agent-profile-feature'

function requireRow(id: string): SessionProvider {
  assertAgentProfilesEnabled()
  const row = typeof id === 'string' ? getSessionProvider(id) : null
  if (!row) throw new Error('Agent Profile no longer exists. Reload the list.')
  return row
}

function summary(row: SessionProvider): ManagedAgentProfile {
  const agent = sessionAgentProfile(row)
  return {
    id: row.id, name: agent.name, harnessId: row.harnessId,
    ...(agent.acpAgentId ? { acpAgentId: agent.acpAgentId } : {}),
    description: readAgentProfile(row.config)?.identity.description ?? '',
    followsDefaults: isDefaultSessionProvider(row), available: isProviderUsable(row),
    approved: isAgentProfileApproved(agent),
  }
}

export function listManagedAgentProfiles(): ManagedAgentProfile[] {
  assertAgentProfilesEnabled()
  return listSessionProviders().map(summary)
}

function detail(row: SessionProvider, catalog: AgentProfileCatalog): AgentProfileManagementDetail {
  const profile = sessionAgentProfile(row)
  const names = new Map(profile.models.map((model) => [model.id, model.name]))
  const agent = { ...profile, models: catalog.models.map((model) => ({ ...model, name: names.get(model.id) ?? model.id })) }
  const config = row.config as Record<string, unknown>
  const baseConfig = agentProfileLaunchConfig({ ...row, config: { ...config, profile: undefined } })
  const version = configFingerprint(row)
  return {
    ...summary(row), agent, catalog, baseConfig, version,
    spec: readAgentProfile(row.config) ?? {
      version: AGENT_PROFILE_VERSION, identity: { name: row.name, description: '' },
      ...(row.isBase ? {} : { runtime: providerLaunchRuntime(row.config) }),
    },
    reviewToken: configFingerprint({ version, catalog, baseConfig, provider: selectedApprovalProvider(agent) }),
  }
}

export async function getManagedAgentProfile(id: string): Promise<AgentProfileManagementDetail> {
  const row = requireRow(id)
  const catalog = await agentProfileCatalog(row)
  return detail(requireRow(id), catalog)
}

/** The explicit Save action in settings approves exactly the configuration shown beside it. */
export async function saveManagedAgentProfile(input: SaveManagedAgentProfile): Promise<{ id: string }> {
  const source = requireRow(input.sourceId)
  if (input.id && (input.id !== source.id || source.isBase)) throw new Error('Default Profiles follow settings and cannot be edited.')
  const parsed = parseManagedProfileDraft(input.draft, source.harnessId)
  if (!parsed.ok) throw new Error(parsed.error)
  const spec = parsed.value
  const catalog = await agentProfileCatalog(source)
  const reviewed = detail(source, catalog)
  const assertReviewed = () => {
    const current = detail(requireRow(source.id), catalog)
    if (current.version !== input.version || current.reviewToken !== input.reviewToken) {
      throw new Error('Profile or launch defaults changed. Reload the Profile and review it again.')
    }
  }
  assertReviewed()
  const config = {
    ...(source.config as Record<string, unknown>), profile: spec,
    ...(source.harnessId === 'acp' && reviewed.agent.acpAgentId ? { agentId: reviewed.agent.acpAgentId } : {}),
  }
  const commit = (write: () => SessionProvider) => getDb().transaction(() => {
    // Catalog validation may await a harness. Fence changes during that wait too.
    assertReviewed()
    const row = write()
    const approvedConfig = profileApprovalConfig(source.harnessId, catalog, reviewed.baseConfig, spec.runtime)
    if (configFingerprint(agentProfileLaunchConfig(row)) !== configFingerprint(approvedConfig)) {
      throw new Error('Launch defaults changed. Reload the Profile and review it again.')
    }
    approveAgentProfile(row, approvedConfig, selectedApprovalProvider(sessionAgentProfile(row)))
    return row
  })()
  const row = input.id
    ? await updateAgentProfile(source, { name: spec.identity.name, config }, commit)
    : await createAgentProfile({ harnessId: source.harnessId, name: spec.identity.name, config }, commit)
  return { id: row.id }
}

export function deleteManagedAgentProfile(input: { id: string; version: string }, host: SessionManagerImpl | null): void {
  const row = requireRow(input.id)
  if (row.isBase) throw new Error('Default Profiles cannot be deleted.')
  if (configFingerprint(row) !== input.version) throw new Error('Profile changed. Reload it before deleting.')
  deleteAgentProfile(row, host)
}
