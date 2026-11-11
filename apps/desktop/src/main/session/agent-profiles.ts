/**
 * Agent profiles = the launchable identities behind `session_collab_request`.
 *
 * One profile per usable SessionProvider row. Today only `is_base = 1` rows
 * exist (one per harness), so a profile reads as "the Codex harness". Once
 * user-defined run configurations ship, every extra `session_providers` row
 * becomes a profile here for free — `agentId` is the provider id, never the
 * harness id, so nothing downstream has to learn a new concept.
 *
 * Split out of session-collaboration.ts (which was past 1600 lines); that file
 * re-exports the public surface so existing importers keep working.
 */

import { isAgentProfilesEnabled } from './agent-profile-feature'
import type {
  AgentMentionTarget,
  EffortLevel,
  HarnessId,
  ModelOption,
  ProviderModelEnv,
  SessionAgentLaunchConfig,
  SessionAgentProfile,
} from '@superone/shared/agent-types'
import { filterEnabledCursorModels } from '@superone/cursor/cursor-config'
import {
  agentLaunchErrors,
  launchConfigFromDefaults,
  launchDefaultsFromConfig,
  providerLaunchRuntime,
  readAgentProfile,
  resolveAgentLaunchDefaults,
  type AgentLaunchDefaults,
  type AgentProfileCatalog,
} from '@superone/shared/agent-profile'
import type { AgentProfileListChoice, AgentProfileListOptionKey } from '@superone/shared/agent-profile-options'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import { isDefaultSessionProvider, sessionProviderDisplayName } from '@superone/shared/session-provider-definitions'
import { acpAgentDisplayName, acpAgentIdForHarness, isAcpProtocolHarness, isAntigravityAcpAgent, resolveHarnessBrandKey } from '@superone/shared/acp-brand'
import { acpAgentDefaultsFor } from '@superone/shared/harness/session-defaults'
import { acpModeCatalog } from '@superone/shared/harness/acp-mode-catalog'
import { buildAgentMentionTargets, decodeAgentRef } from '@superone/shared/agent-mention-tags'
import { isHarnessRunnable, sessionHarnessIdToNodeHarnessId, type NodeHarnessId } from '@superone/shared/environment'
import { formatCodexModelName } from '@superone/shared/codex-model-label'
import { findCodexFastServiceTier } from '@superone/shared/codex-fast-mode'
import { codexPresetForPermissionMode } from '@superone/shared/harness/harness-sandbox'
import { findPlatform, type Credential } from '@superone/shared/platform-registry'
import { readAcpHarnessResources } from '../acp/acp-model-cache'
import { deriveSessionCatalog } from '../acp/acp-config'
import { readAppSettings } from '../app-settings-service'
import { getCachedHarnessResources } from '../database'
import { getHarnessInstallation, getHarnessManager, probeDesktopHarness } from '../harness/service'
import { listCredentials } from '../providers/credential-store'
import { getPlatforms } from '../providers/registry'
import { resolveServiceFromCredential } from '../providers/resolver'
import { listSessionProviders } from './session-provider-repo'
import { readDefaultSessionPrefs } from './session-preferences'
import { subscriptionAccountProviders } from '../agent/remote-selector-catalog'
import { listKnownAccounts as listKnownClaudeAccounts } from '../agent/claude-account-service'
import { defaultChatProviderId } from '../agent/default-chat-provider'
import { codexAccountStore } from '../codex/codex-account-store'

export function resolveAcpAgentId(provider: ReturnType<typeof listSessionProviders>[number]): string | null {
  if (!isAcpProtocolHarness(provider.harnessId)) return null
  const fromConfig = typeof (provider.config as { agentId?: unknown })?.agentId === 'string'
    ? (provider.config as { agentId: string }).agentId.trim()
    : ''
  if (fromConfig && !isDefaultSessionProvider(provider)) return fromConfig
  return acpAgentIdForHarness(provider.harnessId)
}

/**
 * Catalog for one non-ACP harness, read from *its own* cache row.
 *
 * Every harness keys the same cache table, so this is a straight lookup — the
 * one twist is Cursor, whose picker hides models the user disabled in harness
 * config. Collab launches must offer exactly what the composer offers.
 */
export function cachedHarnessModels(harnessId: Exclude<HarnessId, 'acp-grok' | 'acp-antigravity'>): ModelOption[] {
  if (harnessId === 'cursor') {
    const cached = getCachedHarnessResources('cursor')
    return cached ? filterEnabledCursorModels(cached.models, cached) : []
  }
  return getCachedHarnessResources(harnessId)?.models ?? []
}

/**
 * What a profile on this row can be checked against, and what a launch on it
 * defaults to. The global preference layer is computed here per harness; the
 * row's launch runtime and then the launch's own fields go over it through the
 * shared resolver, the same rule the CLI node applies.
 *
 * `lists` adds harness-wide option lists only an async read can produce (dsh
 * presets); without one, a value from that list goes unchecked at launch.
 */
export function profileResources(
  provider: ReturnType<typeof listSessionProviders>[number],
  opts: {
    acpAgentId?: string | null
    launch?: AgentLaunchDefaults
    lists?: Partial<Record<AgentProfileListOptionKey, AgentProfileListChoice[]>>
  } = {},
): {
  models: ModelOption[]
  efforts: string[]
  catalog: AgentProfileCatalog
  defaultConfig: SessionAgentLaunchConfig
} {
  const { acpAgentId, launch } = opts
  const harnessId = provider.harnessId
  const profile = isDefaultSessionProvider(provider) ? undefined : providerLaunchRuntime(provider.config)
  const lists: Partial<Record<AgentProfileListOptionKey, AgentProfileListChoice[]>> = { ...opts.lists }
  if (harnessId === 'opencode') {
    const agents = getCachedHarnessResources('opencode')?.agents
    if (agents) lists.agent = agents.map((agent) => ({ value: agent.id, label: agent.name || agent.id }))
  }
  // No catalog to check against: a written profile was validated already.
  const uncatalogued = () => {
    const catalog: AgentProfileCatalog = { models: [], host: { lists } }
    const preferences = readAppSettings().agentPreference
    const base: AgentLaunchDefaults = harnessId === 'claude'
      ? { model: preferences?.claude?.defaultModel, effort: preferences?.claude?.defaultEffort || undefined }
      : harnessId === 'codex' ? { model: preferences?.codex?.defaultModel, effort: preferences?.codex?.defaultReasoningEffort || undefined } : {}
    return {
      models: [],
      efforts: [],
      catalog,
      defaultConfig: launchConfigFromDefaults(resolveAgentLaunchDefaults({ harnessId, catalog, base, profile, launch })),
    }
  }
  let models: ModelOption[]
  const efforts = new Set<string>()
  let harnessEfforts: string[] | undefined
  let defaultModel: ModelOption | undefined
  let defaultEffort: string | undefined
  let defaultFastMode: boolean | undefined
  if (isAcpProtocolHarness(provider.harnessId)) {
    const cached = readAcpHarnessResources(provider.harnessId)
    if (!cached) return uncatalogued()
    const agentId = acpAgentId ?? resolveAcpAgentId(provider)
    const catalog = agentId ? cached.configByAgentId?.[agentId] : undefined
    const sessionCatalog = catalog ? deriveSessionCatalog(catalog) : null
    models = sessionCatalog?.models ?? []
    // Only Grok reasoning effort is an effort; a real session mode is not.
    const modeCatalog = acpModeCatalog(sessionCatalog)
    const acpEfforts = modeCatalog.efforts.map((option) => option.value)
    lists.mode = modeCatalog.modes.map((mode) => ({ value: mode.id, label: mode.name }))
    harnessEfforts = acpEfforts
    for (const effort of acpEfforts) efforts.add(effort)
    const slot = acpAgentDefaultsFor(readAppSettings().agentPreference, provider.harnessId)
    defaultModel = models.find((model) => model.id === slot.defaultModel)
      ?? models.find((model) => model.id === sessionCatalog?.selectedModelId)
      ?? models.find((model) => model.isDefault)
      ?? models[0]
    const selectedMode = sessionCatalog?.selectedModeId
    defaultEffort = slot.defaultEffort && acpEfforts.includes(slot.defaultEffort)
      ? slot.defaultEffort
      : selectedMode && acpEfforts.includes(selectedMode)
        ? selectedMode
        : acpEfforts.includes('medium') ? 'medium' : acpEfforts[0]
  } else {
    models = cachedHarnessModels(provider.harnessId)
    if (models.length === 0) return uncatalogued()
    const preferences = readAppSettings().agentPreference
    if (provider.harnessId === 'claude') {
      defaultModel = models.find((model) => model.id === preferences.claude.defaultModel) ?? models[0]
      const supported = defaultModel?.supportedEffortLevels ?? []
      defaultEffort = supported.includes(preferences.claude.defaultEffort as EffortLevel)
        ? preferences.claude.defaultEffort
        : supported.includes('high')
          ? 'high'
          : supported.includes('medium')
            ? 'medium'
            : supported[0]
    } else if (provider.harnessId === 'codex') {
      defaultModel = models.find((model) => model.id === preferences.codex.defaultModel)
        ?? models.find((model) => model.isDefault)
        ?? models[0]
      const supported = defaultModel?.supportedReasoningEfforts?.map((effort) => effort.value) ?? []
      defaultEffort = supported.includes(preferences.codex.defaultReasoningEffort as typeof supported[number])
        ? preferences.codex.defaultReasoningEffort
        : defaultModel?.defaultReasoningEffort && supported.includes(defaultModel.defaultReasoningEffort)
          ? defaultModel.defaultReasoningEffort
          : supported[supported.length - 1]
      defaultFastMode = preferences.codex.defaultFastMode && !!findCodexFastServiceTier(defaultModel)
    } else {
      defaultModel = models.find((model) => model.isDefault) ?? models[0]
      const supported = defaultModel?.supportedEffortLevels ?? []
      defaultEffort = supported.includes('medium') ? 'medium' : supported[0]
    }
  }
  for (const model of models) {
    for (const effort of model.supportedEffortLevels ?? []) efforts.add(effort)
    for (const effort of model.supportedReasoningEfforts ?? []) efforts.add(effort.value)
  }
  const catalog: AgentProfileCatalog = { models, ...(harnessEfforts ? { efforts: harnessEfforts } : {}), host: { lists } }
  return {
    models,
    efforts: [...efforts],
    catalog,
    defaultConfig: launchConfigFromDefaults(resolveAgentLaunchDefaults({
      harnessId,
      catalog,
      base: {
        ...(defaultModel ? { model: defaultModel.id } : {}),
        ...(defaultEffort ? { effort: defaultEffort } : {}),
        ...(defaultFastMode !== undefined ? { options: { fastMode: defaultFastMode } } : {}),
      },
      profile,
      launch,
    })),
  }
}

/**
 * A profile is offered only when its harness can actually launch right now.
 *
 * This used to be "has this provider ever run a session", which hid a harness
 * the user had just enabled in Settings — you could not delegate to Codex until
 * you had already opened a Codex session by hand. The catalog row is the honest
 * signal, and it is the same one Settings shows.
 */
function isCatalogHarnessUsable(catalogId: NodeHarnessId | null): boolean {
  if (!catalogId) return false
  const status = getHarnessInstallation(catalogId)
  if (!status.enabled) return false
  if (isHarnessRunnable(status)) return true
  if (status.state !== 'needs_auth') return false
  try { probeDesktopHarness(catalogId) } catch { return false }
  return isHarnessRunnable(getHarnessInstallation(catalogId))
}

export function isProviderUsable(provider: ReturnType<typeof listSessionProviders>[number]): boolean {
  const catalogId = isAcpProtocolHarness(provider.harnessId)
    ? provider.harnessId
    : sessionHarnessIdToNodeHarnessId(provider.harnessId)
  return isCatalogHarnessUsable(catalogId)
}

export function resolveProviderRowId(agentId: string): string {
  const decoded = decodeAgentRef(agentId)
  const providerId = decoded?.providerId ?? agentId
  const providers = listSessionProviders()
  if (providers.some((row) => row.id === providerId)) return providerId
  if ((providerId === 'acp-grok' || providerId === 'acp-antigravity') && providers.some((row) => row.id === 'acp-base')) return 'acp-base'
  if (providerId === 'acp-base') {
    const target = isAntigravityAcpAgent(decoded?.acpAgentId) ? 'acp-antigravity' : 'acp-grok'
    if (providers.some((row) => row.id === target)) return target
  }
  return providerId
}

export function findSessionAgentProfile<T extends { id: string; acpAgentId?: string | null }>(
  profiles: ReadonlyArray<T>,
  agentId: string,
): T | undefined {
  const trimmed = agentId.trim()
  if (!trimmed) return undefined
  const direct = profiles.find((profile) => profile.id === trimmed)
  if (direct) return direct
  const decoded = decodeAgentRef(trimmed)
  if (!decoded) return undefined
  const canonicalId = decoded.providerId === 'acp-base'
    ? (isAntigravityAcpAgent(decoded.acpAgentId) ? 'acp-antigravity' : 'acp-grok')
    : decoded.providerId
  return profiles.find(
    (profile) => profile.id === canonicalId
      || (resolveProviderRowId(profile.id) === resolveProviderRowId(canonicalId)
        && (!decoded.acpAgentId || profile.acpAgentId === decoded.acpAgentId)),
  )
}

function profileDisplayName(
  provider: ReturnType<typeof listSessionProviders>[number],
  acpAgentId: string | null,
): string {
  // A user-named agent keeps its name, a base row reads as its harness, and the
  // built-in ACP row as its agent.
  if (!isAcpProtocolHarness(provider.harnessId) || readAgentProfile(provider.config)) return sessionProviderDisplayName(provider)
  const cached = readAcpHarnessResources(provider.harnessId)
  const catalogName = acpAgentId
    ? cached?.agents?.find((agent) => agent.id === acpAgentId)?.name
    : null
  return acpAgentDisplayName(acpAgentId, catalogName)
}

type ApiProviderRow = SessionAgentProfile['apiProviders'][number]

/**
 * Match the chat model selector: platform registry name as the primary label,
 * user-defined credential name as the secondary key label. The Claude slot
 * mapping rides along so a client without the credential store (Remote
 * Control) can name the model the key actually serves.
 */
function apiProviderOption(credential: Credential, modelEnv: ProviderModelEnv | undefined): ApiProviderRow {
  const platform = findPlatform(getPlatforms(), credential.platformId)
  return {
    id: credential.id,
    name: platform?.name ?? credential.name,
    ...(platform?.brand ? { brand: platform.brand } : {}),
    ...(credential.name ? { keyName: credential.name } : {}),
    ...(modelEnv ? { modelEnv } : {}),
  }
}

/** Same rows as the main chat provider picker: subscription accounts, then endpoint-capable credentials. */
function listApiProvidersForHarness(harnessId: 'claude' | 'codex'): ApiProviderRow[] {
  const consumer = harnessId === 'codex' ? 'chat:codex' : 'chat:claude'
  const options = { experimentalClaudeOpenAiChatEnabled: readAppSettings().experimentalClaudeOpenAiChatEnabled }
  const accounts = subscriptionAccountProviders(harnessId, harnessId === 'claude'
    ? { claudeAccounts: listKnownClaudeAccounts() }
    : { codexAccounts: codexAccountStore().list() })
  return [
    ...accounts.map(({ id, name, brand, keyName }) => ({ id, name, ...(brand ? { brand } : {}), ...(keyName ? { keyName } : {}) })),
    ...listCredentials().flatMap((credential) => {
      const resolved = resolveServiceFromCredential(consumer, credential, null, options)
      return resolved ? [apiProviderOption(credential, resolved.modelMapping)] : []
    }),
  ]
}

/**
 * What a new session on this profile starts with when the launch leaves a field
 * out: the user's model, effort, permission and sandbox defaults, and the
 * provider or account their chats are bound to.
 */
function launchDefaultConfig(
  harnessId: HarnessId,
  resources: SessionAgentLaunchConfig,
  acpAgentId?: string | null,
): SessionAgentLaunchConfig {
  const { permissionMode, sandboxMode } = readDefaultSessionPrefs(harnessId, acpAgentId)
  const apiProviderId = harnessId === 'claude' || harnessId === 'codex'
    ? defaultChatProviderId(harnessId, { experimentalClaudeOpenAiChatEnabled: readAppSettings().experimentalClaudeOpenAiChatEnabled })
    : null
  return {
    ...resources,
    // A profile's own mode wins over the user's per-harness default.
    permissionMode: resources.permissionMode ?? permissionMode,
    ...(sandboxMode ? { sandboxMode } : {}),
    ...(apiProviderId ? { apiProviderId } : {}),
    ...(harnessId === 'codex' ? { codexPermissionPreset: resources.permissionMode
      ? codexPresetForPermissionMode(resources.permissionMode)
      : readAppSettings().agentPreference.codex.defaultPermissionPreset || codexPresetForPermissionMode(permissionMode) } : {}),
  }
}

/** Virtual proposals and stored Profiles use the same default resolution. */
export function agentProfileLaunchConfig(provider: ReturnType<typeof listSessionProviders>[number]): SessionAgentLaunchConfig {
  const acpAgentId = isAcpProtocolHarness(provider.harnessId) ? resolveAcpAgentId(provider) : null
  return launchDefaultConfig(provider.harnessId, profileResources(provider, {
    acpAgentId,
  }).defaultConfig, acpAgentId)
}

/**
 * Every launchable provider row, base rows first (that ordering is load-bearing
 * for `@` slug de-duplication: a user-defined "Codex" gets suffixed, the
 * built-in keeps the plain keyword).
 *
 * No `isBase` filter — the day custom run configurations ship, they become
 * launchable and mentionable through this one function.
 */
function providerEntries(
  accept: (provider: ReturnType<typeof listSessionProviders>[number]) => boolean,
): Array<{
  provider: ReturnType<typeof listSessionProviders>[number]
  acpAgentId: string | null
}> {
  const enabled = isAgentProfilesEnabled()
  return listSessionProviders()
    .filter((provider) => enabled || !readAgentProfile(provider.config))
    .filter(accept)
    .map((provider) => ({
      provider,
      acpAgentId: isAcpProtocolHarness(provider.harnessId) ? resolveAcpAgentId(provider) : null,
    }))
}

/** Mention and collaboration profiles. A `needs_auth` row is probed once. */
function usableProviders() {
  return providerEntries(isProviderUsable)
}

/**
 * Agents `session.create` would accept on this machine: enabled and ready.
 * Suggest-task cards use this, not the Settings catalog. A `needs_auth` row
 * stays hidden until a probe has already marked it ready.
 */
export function listRunnableSessionAgentProfiles(): SessionAgentProfile[] {
  const harnesses = getHarnessManager()
  return providerEntries((provider) => harnesses.isSessionHarnessRunnable(provider.harnessId))
    .map(({ provider, acpAgentId }) => sessionAgentProfile(provider, acpAgentId))
}

export function sessionAgentLaunchDefaults(
  profile: SessionAgentProfile,
  launch: Pick<SessionAgentLaunchConfig, 'model' | 'effort' | 'fastMode' | 'permissionMode'> | undefined,
): SessionAgentLaunchConfig {
  const explicit = launchDefaultsFromConfig(launch)
  const providerId = resolveProviderRowId(profile.id)
  const provider = Object.keys(explicit).length ? listSessionProviders().find((row) => row.id === providerId) : undefined
  let config = profile.defaultConfig
  if (provider) {
    const resources = profileResources(provider, { acpAgentId: profile.acpAgentId ?? null, launch: explicit })
    const harness = { id: provider.harnessId, name: HARNESS_CAPABILITIES[provider.harnessId]?.displayName ?? provider.harnessId }
    const errors = agentLaunchErrors(harness, resources.catalog, resources.defaultConfig.model, explicit)
    if (errors.length) throw new Error(errors.join(' '))
    config = launchDefaultConfig(provider.harnessId, resources.defaultConfig, profile.acpAgentId ?? null)
  }
  if (launch?.permissionMode !== undefined) {
    return profile.harnessId === 'codex' ? { ...config, codexPermissionPreset: codexPresetForPermissionMode(launch.permissionMode) } : config
  }
  return config
}

export function sessionAgentProfile(
  provider: ReturnType<typeof listSessionProviders>[number],
  explicitAcpAgentId?: string | null,
): SessionAgentProfile {
  const acpAgentId = isAcpProtocolHarness(provider.harnessId)
    ? (explicitAcpAgentId !== undefined ? explicitAcpAgentId : resolveAcpAgentId(provider))
    : null
  const resources = profileResources(provider, { acpAgentId })
  const models = resources.models.map((model) => ({
    id: model.id,
    name: provider.harnessId === 'codex'
      ? formatCodexModelName(model.name, model.id)
      : (model.name || model.id),
    ...(model.description ? { description: model.description } : {}),
    ...(model.supportsFastMode ? { supportsFastMode: true } : {}),
    ...(model.serviceTiers?.length ? { serviceTiers: model.serviceTiers } : {}),
    ...(model.supportedEffortLevels?.length ? { supportedEffortLevels: model.supportedEffortLevels } : {}),
    ...(model.supportedReasoningEfforts?.length ? {
      supportedReasoningEfforts: model.supportedReasoningEfforts.map((effort) => ({
        value: effort.value,
        ...(effort.description ? { description: effort.description } : {}),
      })),
    } : {}),
  }))
  const name = profileDisplayName(provider, acpAgentId)
  const brandKey = resolveHarnessBrandKey(provider.harnessId, acpAgentId)
  const id =
    provider.id === 'acp-base'
      ? (isAntigravityAcpAgent(acpAgentId) ? 'acp-antigravity' : 'acp-grok')
      : provider.id
  return {
    id,
    name,
    harnessId: provider.harnessId,
    ...(isDefaultSessionProvider(provider) && isAgentProfilesEnabled() ? { followsDefaults: true } : {}),
    ...(acpAgentId ? { acpAgentId } : {}),
    brandKey,
    description: readAgentProfile(provider.config)?.identity.description
      ?? (isAcpProtocolHarness(provider.harnessId)
        ? `ACP agent ${acpAgentId ?? 'unknown'} (${brandKey})`
        : `${provider.harnessId} harness with the built-in configuration`),
    defaultConfig: launchDefaultConfig(provider.harnessId, resources.defaultConfig, acpAgentId),
    models,
    efforts: resources.efforts,
    apiProviders: provider.harnessId === 'claude' || provider.harnessId === 'codex'
      ? listApiProvidersForHarness(provider.harnessId)
      : [],
  }
}

export function listSessionAgentProfiles(): SessionAgentProfile[] {
  return usableProviders().map(({ provider, acpAgentId }) => sessionAgentProfile(provider, acpAgentId))
}

/**
 * The `@codex` / `@grok` popup list. Deliberately derived from the same
 * `usableProviders()` set as `listSessionAgentProfiles`, so the composer can
 * never offer an agent that `session_collab_request` would then reject.
 */
export function listAgentMentionTargets(): AgentMentionTarget[] {
  return buildAgentMentionTargets(
    usableProviders().map(({ provider, acpAgentId }) => ({
      providerId: provider.id,
      harnessId: provider.harnessId,
      name: provider.name,
      isBase: provider.isBase,
      acpAgentId,
    })),
  )
}
