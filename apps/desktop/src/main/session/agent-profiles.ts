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
  SessionAgentLaunchConfig,
  SessionAgentProfile,
} from '@superone/shared/agent-types'
import { filterEnabledCursorModels } from '@superone/cursor/cursor-config'
import { acpAgentDisplayName, resolveHarnessBrandKey } from '@superone/shared/acp-brand'
import { buildAgentMentionTargets } from '@superone/shared/agent-mention-tags'
import {
  isHarnessRunnable,
  sessionHarnessIdToNodeHarnessId,
} from '@superone/shared/environment'
import { formatCodexModelName } from '@superone/shared/codex-model-label'
import {
  effectiveEndpoints,
  findPlan,
  findPlatform,
  selectEndpoint,
  type Credential,
} from '@superone/shared/platform-registry'
import { deriveSessionCatalog } from '../acp/acp-config'
import { readAppSettings } from '../app-settings-service'
import { getCachedHarnessResources } from '../database'
import { getHarnessInstallation, probeDesktopHarness } from '../harness/service'
import { listCredentials } from '../providers/credential-store'
import { getPlatforms } from '../providers/registry'
import { listSessionProviders } from './session-provider-repo'

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
function cachedHarnessModels(harnessId: Exclude<HarnessId, 'acp'>): ModelOption[] {
  if (harnessId === 'cursor') {
    const cached = getCachedHarnessResources('cursor')
    return cached ? filterEnabledCursorModels(cached.models, cached) : []
  }
  return getCachedHarnessResources(harnessId)?.models ?? []
}

function profileResources(
  provider: ReturnType<typeof listSessionProviders>[number],
  acpAgentId?: string | null,
): {
  models: ModelOption[]
  efforts: string[]
  defaultConfig: SessionAgentLaunchConfig
} {
  let models: ModelOption[]
  const efforts = new Set<string>()
  let defaultModel: ModelOption | undefined
  let defaultEffort: string | undefined
  if (provider.harnessId === 'acp') {
    const cached = getCachedHarnessResources('acp')
    if (!cached) return { models: [], efforts: [], defaultConfig: {} }
    const agentId = acpAgentId ?? resolveAcpAgentId(provider) ?? cached.selectedAgentId
    const catalog = agentId ? cached.configByAgentId?.[agentId] : undefined
    const sessionCatalog = catalog ? deriveSessionCatalog(catalog) : null
    models = sessionCatalog?.models ?? []
    for (const mode of sessionCatalog?.modes ?? []) efforts.add(mode.id)
    defaultModel = models.find((model) => model.id === sessionCatalog?.selectedModelId)
      ?? models.find((model) => model.isDefault)
      ?? models[0]
    defaultEffort = sessionCatalog?.selectedModeId
      ?? sessionCatalog?.modes.find((mode) => mode.isDefault)?.id
      ?? sessionCatalog?.modes[0]?.id
  } else {
    models = cachedHarnessModels(provider.harnessId)
    if (models.length === 0) return { models: [], efforts: [], defaultConfig: {} }
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
  return {
    models,
    efforts: [...efforts],
    defaultConfig: {
      ...(defaultModel ? { model: defaultModel.id } : {}),
      ...(defaultEffort ? { effort: defaultEffort } : {}),
    },
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
function isProviderUsable(provider: ReturnType<typeof listSessionProviders>[number]): boolean {
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
  if (provider.harnessId !== 'acp') return provider.name
  const cached = getCachedHarnessResources('acp')
  const catalogName = acpAgentId
    ? cached?.agents?.find((agent) => agent.id === acpAgentId)?.name
    : null
  return acpAgentDisplayName(acpAgentId, catalogName)
}

/**
 * Match the chat model selector: platform registry name as the primary label,
 * user-defined credential name as the secondary key label.
 */
function apiProviderOption(credential: Credential): {
  id: string
  name: string
  brand?: string
  keyName?: string
} {
  const platform = findPlatform(getPlatforms(), credential.platformId)
  return {
    id: credential.id,
    name: platform?.name ?? credential.name,
    ...(platform?.brand ? { brand: platform.brand } : {}),
    ...(credential.name ? { keyName: credential.name } : {}),
  }
}

/** Same filter as the main chat provider picker (endpoint-capable credentials). */
function listApiProvidersForHarness(harnessId: 'claude' | 'codex'): Array<{
  id: string
  name: string
  brand?: string
  keyName?: string
}> {
  const consumer = harnessId === 'codex' ? 'chat:codex' : 'chat:claude'
  const platforms = getPlatforms()
  return listCredentials()
    .filter((credential) => {
      const platform = findPlatform(platforms, credential.platformId)
      const plan = findPlan(platform, credential.planId)
      if (!platform || !plan) return false
      const endpoints = effectiveEndpoints(platform, plan, credential)
      return !!selectEndpoint(plan, consumer, undefined, credential, endpoints, {
        experimentalClaudeOpenAiChatEnabled: readAppSettings().experimentalClaudeOpenAiChatEnabled,
      })
    })
    .map(apiProviderOption)
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

export function listSessionAgentProfiles(): SessionAgentProfile[] {
  return usableProviders().map(({ provider, acpAgentId }) => {
    const resources = profileResources(provider, acpAgentId)
    const models = resources.models.map((model) => ({
      id: model.id,
      name: provider.harnessId === 'codex'
        ? formatCodexModelName(model.name, model.id)
        : (model.name || model.id),
      ...(model.description ? { description: model.description } : {}),
    }))
    const name = profileDisplayName(provider, acpAgentId)
    const brandKey = resolveHarnessBrandKey(provider.harnessId, acpAgentId)
    return {
      id: provider.id,
      name,
      harnessId: provider.harnessId,
      ...(acpAgentId ? { acpAgentId } : {}),
      brandKey,
      description: provider.harnessId === 'acp'
        ? `ACP agent ${acpAgentId ?? 'unknown'} (${brandKey})`
        : `${provider.harnessId} harness with the built-in configuration`,
      defaultConfig: resources.defaultConfig,
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

