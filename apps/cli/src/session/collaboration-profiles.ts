import type { SessionAgentLaunchConfig, SessionAgentProfile } from '@superone/shared/agent-types'
import {
  agentLaunchErrors,
  launchConfigFromDefaults,
  launchDefaultsFromConfig,
  providerLaunchRuntime,
  providerSystemPromptAppend,
  readAgentProfile,
  resolveAgentLaunchDefaults,
  type AgentLaunchDefaults,
  type AgentProfileCatalog,
} from '@superone/shared/agent-profile'
import type { AgentProfileOptionKey } from '@superone/shared/agent-profile-options'
import { normalizeSessionHarnessId } from '@superone/shared/environment'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import { sessionProviderDisplayName } from '@superone/shared/session-provider-definitions'
import { acpAgentDisplayName, resolveHarnessBrandKey } from '@superone/shared/acp-brand'
import type { HarnessId } from '@superone/shared/session-types'
import { listHarnessApiProviders, listHarnessModels } from '../provider/resolve-service'
import { CollaborationError, collaborationSystemPrompt, type CollaborationGrantRow } from '@superone/runtime/collaboration'
import type { CollaborationDeps } from './collaboration-context'

function providerOptions(deps: CollaborationDeps) {
  return { experimentalClaudeOpenAiChatEnabled: deps.experimentalClaudeOpenAiChatEnabled?.() ?? false }
}

/**
 * The profile options a session on this node can start with: its runtime
 * takes the OpenCode agent at create and refuses every other harness setting
 * (`SessionRuntime.validateSettings`), so the rest never reach a launch here.
 */
const NODE_APPLIABLE_OPTIONS: readonly AgentProfileOptionKey[] = ['agent']

/**
 * A row's catalog and launch defaults. This node keeps no agent preferences,
 * so its global layer is the catalog default; the row's launch runtime and
 * then the launch's own fields go over it, the rule desktop applies too.
 */
function launchResolution(
  deps: CollaborationDeps,
  harnessId: HarnessId,
  config: unknown,
  launch?: AgentLaunchDefaults,
) {
  const harnessModels = listHarnessModels(deps.providers, harnessId, null, providerOptions(deps))
  const defaultModel = harnessModels.find((m) => m.isDefault) ?? harnessModels[0]
  const efforts = new Set<string>()
  for (const m of harnessModels) {
    for (const e of m.supportedEffortLevels ?? []) efforts.add(e)
  }
  const catalog: AgentProfileCatalog = { models: harnessModels, host: { appliable: NODE_APPLIABLE_OPTIONS } }
  const defaults = resolveAgentLaunchDefaults({
    harnessId,
    catalog,
    base: {
      model: defaultModel?.id,
      effort: efforts.has('high') ? 'high' : efforts.has('medium') ? 'medium' : [...efforts][0],
    },
    profile: providerLaunchRuntime(config),
    launch,
  })
  return { harnessModels, efforts, catalog, defaults }
}

/**
 * The defaults one launch of `profile` starts from: a launch naming its own
 * model, effort or fast mode re-resolves the inherited rest against that
 * model, and an explicit value the model cannot carry is rejected.
 */
export function collaborationLaunchDefaults(
  deps: CollaborationDeps,
  profile: SessionAgentProfile,
  launch: Pick<SessionAgentLaunchConfig, 'model' | 'effort' | 'fastMode'>,
): SessionAgentLaunchConfig {
  const explicit: AgentLaunchDefaults = launchDefaultsFromConfig(launch)
  if (!Object.keys(explicit).length) return profile.defaultConfig
  const { catalog, defaults } = launchResolution(deps, profile.harnessId, deps.sessionProviders?.get(profile.id)?.config, explicit)
  const harness = { id: profile.harnessId, name: HARNESS_CAPABILITIES[profile.harnessId]?.displayName ?? profile.harnessId }
  const errors = agentLaunchErrors(harness, catalog, defaults.model, explicit)
  if (errors.length) throw new CollaborationError(errors.join(' '), 'invalid_argument')
  return launchConfigFromDefaults(defaults)
}

/** Agent profiles from session_providers (+ ready-harness fallback). */
export function listCollaborationProfiles(deps: CollaborationDeps): SessionAgentProfile[] {
  const { harnesses, providers, sessions, sessionProviders } = deps
  const profiles: SessionAgentProfile[] = []
  const seen = new Set<string>()

  const pushProfile = (
    profileId: string,
    harnessId: HarnessId,
    name: string,
    description: string,
    /** Optional session_providers.config — multi-profile defaults. */
    profileConfig?: unknown,
  ) => {
    if (seen.has(profileId)) return
    // Same gate as session.create: never offer an agent this node cannot
    // launch. Desktop applies the identical enabled+ready rule, so a
    // remote @codex mention means the same thing on both sides.
    if (!harnesses.isSessionHarnessRunnable(harnessId)) return
    seen.add(profileId)
    const { harnessModels, efforts, defaults } = launchResolution(deps, harnessId, profileConfig)
    const models = harnessModels.map((m) => ({
      id: m.id,
      name: m.name || m.id,
      ...(m.description ? { description: m.description } : {}),
      ...(m.serviceTiers?.length ? { serviceTiers: m.serviceTiers } : {}),
    }))
    const cfg =
      profileConfig && typeof profileConfig === 'object' && !Array.isArray(profileConfig)
        ? (profileConfig as Record<string, unknown>)
        : {}
    // ACP is a protocol, not a brand: the row's config names the concrete
    // agent (grok-build), which is what the user sees and @-mentions.
    const acpAgentId =
      harnessId === 'acp' && typeof cfg.agentId === 'string' && cfg.agentId.trim()
        ? cfg.agentId.trim()
        : null
    const profile = readAgentProfile(profileConfig)
    profiles.push({
      id: profileId,
      name: profile ? name : harnessId === 'acp' ? acpAgentDisplayName(acpAgentId) : name,
      harnessId,
      ...(acpAgentId ? { acpAgentId } : {}),
      brandKey: resolveHarnessBrandKey(harnessId, acpAgentId),
      description: profile?.identity.description ?? description,
      defaultConfig: launchConfigFromDefaults(defaults),
      models: models.length > 0 ? models : [{ id: 'default', name: 'Default' }],
      efforts: [...efforts],
      apiProviders: listHarnessApiProviders(providers, harnessId, providerOptions(deps)),
    })
  }

  // Prefer CRUD-managed session_providers (base + custom multi-profile).
  if (sessionProviders) {
    for (const p of sessionProviders.list()) {
      pushProfile(
        p.id,
        p.harnessId,
        sessionProviderDisplayName(p),
        p.isBase
          ? `${p.harnessId} harness with the built-in configuration`
          : `Custom ${p.harnessId} profile`,
        p.config,
      )
    }
  }

  // Fallback for a node without the session_providers store: ready harnesses,
  // plus any harness that has actually run a session here. Previously this
  // seeded EVERY catalog harness when none were ready, which offered agents
  // the node could not launch; pushProfile's gate now rejects those anyway.
  if (profiles.length === 0) {
    const seedIds = new Set<string>(harnesses.readySessionHarnessIds())
    for (const s of sessions.list()) {
      if (s.harnessId) seedIds.add(s.harnessId)
    }
    for (const id of seedIds) {
      const harnessId = (normalizeSessionHarnessId(id) ?? id) as HarnessId
      pushProfile(harnessId, harnessId, harnessId, `${harnessId} harness`)
    }
  }

  return profiles
}

/**
 * The system-prompt append for a session of `agentId`: its profile block
 * first, then the collaboration protocol (absent for a handoff).
 */
export function collaborationAgentPromptAppend(
  deps: Pick<CollaborationDeps, 'sessionProviders'>,
  agentId: string,
  protocol?: string,
): string | undefined {
  return providerSystemPromptAppend(deps.sessionProviders?.get(agentId)?.config, protocol)
}

/**
 * The append of a session a spawn or handoff grant launched, from the agent's
 * current row: a spawn child also gets the collaboration protocol, a handoff
 * (one-way by construction) only the profile's instructions.
 */
export function launchedSessionPromptAppend(
  deps: Pick<CollaborationDeps, 'sessionProviders'>,
  grant: Pick<CollaborationGrantRow, 'agent_id' | 'kind' | 'parent_session_id'>,
): string | undefined {
  return collaborationAgentPromptAppend(
    deps,
    grant.agent_id,
    grant.kind === 'handoff' ? undefined : collaborationSystemPrompt(grant.parent_session_id),
  )
}
