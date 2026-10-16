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
import { sessionProviderDisplayName } from '@superone/shared/session-provider-definitions'
import { acpAgentDisplayName, resolveHarnessBrandKey } from '@superone/shared/acp-brand'
import { acpModeCatalog } from '@superone/shared/harness/acp-mode-catalog'
import { buildAgentMentionTargets } from '@superone/shared/agent-mention-tags'
import {
  isHarnessRunnable,
  sessionHarnessIdToNodeHarnessId,
} from '@superone/shared/environment'
import { formatCodexModelName } from '@superone/shared/codex-model-label'
import { findCodexFastServiceTier } from '@superone/shared/codex-fast-mode'
import { findPlatform, type Credential } from '@superone/shared/platform-registry'
import { deriveSessionCatalog } from '../acp/acp-config'
import { readAppSettings } from '../app-settings-service'
import { getCachedHarnessResources } from '../database'
import { getHarnessInstallation, probeDesktopHarness } from '../harness/service'
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
  const fromConfig = typeof (provider.config as { agentId?: unknown })?.agentId === 'string'
    ? (provider.config as { agentId: string }).agentId.trim()
    : ''
  if (fromConfig) return fromConfig
  const selected = readAppSettings().agentPreference?.acp?.selectedAgentId
  if (typeof selected === 'string' && selected.trim()) return selected.trim()
  const cached = getCachedHarnessResources('acp')
  if (typeof cached?.selectedAgentId === 'string' && cached.selectedAgentId.trim()) {
    return cached.selectedAgentId.trim()
  }
  return null
}

/**
 * Catalog for one non-ACP harness, read from *its own* cache row.
 *
 * Every harness keys the same cache table, so this is a straight lookup — the
 * one twist is Cursor, whose picker hides models the user disabled in harness
 * config. Collab launches must offer exactly what the composer offers.
 */
export function cachedHarnessModels(harnessId: Exclude<HarnessId, 'acp'>): ModelOption[] {
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
  const profile = providerLaunchRuntime(provider.config)
  const lists: Partial<Record<AgentProfileListOptionKey, AgentProfileListChoice[]>> = { ...opts.lists }
  if (harnessId === 'opencode') {
    const agents = getCachedHarnessResources('opencode')?.agents
    if (agents) lists.agent = agents.map((agent) => ({ value: agent.id, label: agent.name || agent.id }))
  }
  // No catalog to check against: a written profile was validated already.
  const uncatalogued = () => {
    const catalog: AgentProfileCatalog = { models: [], host: { lists } }
    return {
      models: [],
      efforts: [],
      catalog,
      defaultConfig: launchConfigFromDefaults(resolveAgentLaunchDefaults({ harnessId, catalog, base: {}, profile, launch })),
    }
  }
  let models: ModelOption[]
  const efforts = new Set<string>()
  let harnessEfforts: string[] | undefined
  let defaultModel: ModelOption | undefined
  let defaultEffort: string | undefined
  let defaultFastMode: boolean | undefined
  if (provider.harnessId === 'acp') {
    const cached = getCachedHarnessResources('acp')
    if (!cached) return uncatalogued()
    const agentId = acpAgentId ?? resolveAcpAgentId(provider) ?? cached.selectedAgentId
    const catalog = agentId ? cached.configByAgentId?.[agentId] : undefined
    const sessionCatalog = catalog ? deriveSessionCatalog(catalog) : null
    models = sessionCatalog?.models ?? []
    // Only Grok reasoning effort is an effort; a real session mode is not.
    const modeCatalog = acpModeCatalog(sessionCatalog)
    const acpEfforts = modeCatalog.efforts.map((option) => option.value)
    lists.mode = modeCatalog.modes.map((mode) => ({ value: mode.id, label: mode.name }))
    harnessEfforts = acpEfforts
    for (const effort of acpEfforts) efforts.add(effort)
    defaultModel = models.find((model) => model.id === sessionCatalog?.selectedModelId)
      ?? models.find((model) => model.isDefault)
      ?? models[0]
    const selectedMode = sessionCatalog?.selectedModeId
    defaultEffort = selectedMode && acpEfforts.includes(selectedMode)
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
export function isProviderUsable(provider: ReturnType<typeof listSessionProviders>[number]): boolean {
  const catalogId = sessionHarnessIdToNodeHarnessId(provider.harnessId)
  if (!catalogId) return false
  const status = getHarnessInstallation(catalogId)
  if (!status.enabled) return false
  if (isHarnessRunnable(status)) return true
  // `needs_auth` can be stale: credentials added after the last probe leave the
  // row behind. Re-probe those (cheap: binary + credential lookup) rather than
  // silently dropping a harness the user just signed into.
  if (status.state !== 'needs_auth') return false
  try {
    probeDesktopHarness(catalogId)
  } catch {
    return false
  }
  return isHarnessRunnable(getHarnessInstallation(catalogId))
}

function profileDisplayName(
  provider: ReturnType<typeof listSessionProviders>[number],
  acpAgentId: string | null,
): string {
  // A user-named agent keeps its name, a base row reads as its harness, and the
  // built-in ACP row as its agent.
  if (provider.harnessId !== 'acp' || readAgentProfile(provider.config)) return sessionProviderDisplayName(provider)
  const cached = getCachedHarnessResources('acp')
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
function launchDefaultConfig(harnessId: HarnessId, resources: SessionAgentLaunchConfig): SessionAgentLaunchConfig {
  const { permissionMode, sandboxMode } = readDefaultSessionPrefs(harnessId)
  const apiProviderId = harnessId === 'claude' || harnessId === 'codex'
    ? defaultChatProviderId(harnessId, { experimentalClaudeOpenAiChatEnabled: readAppSettings().experimentalClaudeOpenAiChatEnabled })
    : null
  return {
    ...resources,
    // A profile's own mode wins over the user's per-harness default.
    permissionMode: resources.permissionMode ?? permissionMode,
    ...(sandboxMode ? { sandboxMode } : {}),
    ...(apiProviderId ? { apiProviderId } : {}),
  }
}

/**
 * Every launchable provider row, base rows first (that ordering is load-bearing
 * for `@` slug de-duplication: a user-defined "Codex" gets suffixed, the
 * built-in keeps the plain keyword).
 *
 * No `isBase` filter — the day custom run configurations ship, they become
 * launchable and mentionable through this one function.
 */
function usableProviders(): Array<{
  provider: ReturnType<typeof listSessionProviders>[number]
  acpAgentId: string | null
}> {
  return listSessionProviders()
    .filter(isProviderUsable)
    .map((provider) => ({
      provider,
      acpAgentId: provider.harnessId === 'acp' ? resolveAcpAgentId(provider) : null,
    }))
}

/**
 * The defaults one launch of `profile` starts from. A launch that names its
 * own model, effort or fast mode re-resolves the rest against that model, so
 * an inherited value the model cannot carry is dropped; an explicit one is
 * rejected. Explicit launch fields still go over the result.
 */
export function sessionAgentLaunchDefaults(
  profile: SessionAgentProfile,
  launch: Pick<SessionAgentLaunchConfig, 'model' | 'effort' | 'fastMode'> | undefined,
): SessionAgentLaunchConfig {
  const explicit = launchDefaultsFromConfig(launch)
  const provider = Object.keys(explicit).length ? listSessionProviders().find((row) => row.id === profile.id) : undefined
  if (!provider) return profile.defaultConfig
  const resources = profileResources(provider, { acpAgentId: profile.acpAgentId ?? null, launch: explicit })
  const harness = { id: provider.harnessId, name: HARNESS_CAPABILITIES[provider.harnessId]?.displayName ?? provider.harnessId }
  const errors = agentLaunchErrors(harness, resources.catalog, resources.defaultConfig.model, explicit)
  if (errors.length) throw new Error(errors.join(' '))
  return launchDefaultConfig(provider.harnessId, resources.defaultConfig)
}

export function listSessionAgentProfiles(): SessionAgentProfile[] {
  return usableProviders().map(({ provider, acpAgentId }) => {
    const resources = profileResources(provider, { acpAgentId })
    const models = resources.models.map((model) => ({
      id: model.id,
      name: provider.harnessId === 'codex'
        ? formatCodexModelName(model.name, model.id)
        : (model.name || model.id),
      ...(model.description ? { description: model.description } : {}),
      ...(model.serviceTiers?.length ? { serviceTiers: model.serviceTiers } : {}),
    }))
    const name = profileDisplayName(provider, acpAgentId)
    const brandKey = resolveHarnessBrandKey(provider.harnessId, acpAgentId)
    return {
      id: provider.id,
      name,
      harnessId: provider.harnessId,
      ...(acpAgentId ? { acpAgentId } : {}),
      brandKey,
      description: readAgentProfile(provider.config)?.identity.description
        ?? (provider.harnessId === 'acp'
          ? `ACP agent ${acpAgentId ?? 'unknown'} (${brandKey})`
          : `${provider.harnessId} harness with the built-in configuration`),
      defaultConfig: launchDefaultConfig(provider.harnessId, resources.defaultConfig),
      models,
      efforts: resources.efforts,
      apiProviders: provider.harnessId === 'claude' || provider.harnessId === 'codex'
        ? listApiProvidersForHarness(provider.harnessId)
        : [],
    }
  })
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
