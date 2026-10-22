import type {
  CodexReasoningEffort,
  ModelOption,
  RemoteEffortOption,
  RemoteProviderOption,
  SessionAgentLaunchConfig,
  SessionAgentLaunchSettings,
  SessionAgentProfile,
} from '@superone/shared/agent-types'
import { claudeFastModeOption, supportsClaudeFastMode } from '@superone/shared/claude-fast-mode'
import { findCodexFastServiceTier } from '@superone/shared/codex-fast-mode'
import { formatEffortLabel } from '@superone/shared/effort-labels'
import { effortOptionsForModel, selectedProviderModelEnv } from './model-selection-state'
import { optionParamsForModel, type SelectorCatalogParam } from './model-picker-state'

const NO_UNION_FALLBACK = new Set<SessionAgentProfile['harnessId']>(['cursor', 'dsh'])

/** A profile model as the picker catalog, which requires a description. */
function catalogModel(model: SessionAgentProfile['models'][number]): ModelOption {
  return {
    id: model.id,
    name: model.name,
    description: model.description ?? '',
    ...(model.supportsFastMode ? { supportsFastMode: true } : {}),
    ...(model.serviceTiers ? { serviceTiers: model.serviceTiers } : {}),
    ...(model.supportedEffortLevels ? { supportedEffortLevels: model.supportedEffortLevels as ModelOption['supportedEffortLevels'] } : {}),
    ...(model.supportedReasoningEfforts ? {
      supportedReasoningEfforts: model.supportedReasoningEfforts.map((effort) => ({
        value: effort.value as CodexReasoningEffort,
        description: effort.description ?? '',
      })),
    } : {}),
  }
}

function providersFor(profile: SessionAgentProfile): RemoteProviderOption[] {
  if (!profile.apiProviders.length) return []
  return [
    { id: null, name: 'Default provider', brand: profile.harnessId === 'codex' ? 'openai' : 'claude' },
    ...profile.apiProviders.map((provider) => ({
      id: provider.id,
      name: provider.name,
      brand: provider.brand ?? null,
      keyName: provider.keyName,
      modelEnv: provider.modelEnv,
    })),
  ]
}

/**
 * Effort the desktop launch selector would show: the model's own levels, the
 * profile union where that selector falls back to it, and nothing once a
 * Claude credential remaps the catalog.
 */
export function suggestedTaskEfforts(
  profile: SessionAgentProfile,
  modelId: string | undefined,
  apiProviderId: string | null | undefined,
): RemoteEffortOption[] {
  const providers = providersFor(profile)
  const info = { models: profile.models.map(catalogModel), efforts: profile.efforts.map((value) => ({ value, label: formatEffortLabel(value) })), providers }
  if (profile.harnessId === 'claude' && selectedProviderModelEnv(info, apiProviderId)) return []
  const specific = effortOptionsForModel(profile.harnessId, info, modelId ?? '', apiProviderId ?? null)
  if (specific.length || NO_UNION_FALLBACK.has(profile.harnessId)) return specific
  return info.efforts ?? []
}

function keptEffort(options: RemoteEffortOption[], current: string | undefined): string | undefined {
  if (!options.length) return undefined
  if (current && options.some((option) => option.value === current)) return current
  return options.find((option) => option.value === 'medium')?.value ?? options[0]?.value
}

export interface SuggestedTaskLaunchView {
  models: ModelOption[]
  efforts: RemoteEffortOption[]
  optionParams: SelectorCatalogParam[]
  providers: RemoteProviderOption[]
  model: string
  effort: string
  providerId: string | null
}

/** The desktop card's model menu, from the host profile a phone actually receives. */
export function suggestedTaskLaunchView(profile: SessionAgentProfile, config: SessionAgentLaunchConfig): SuggestedTaskLaunchView {
  const models = profile.models.map(catalogModel)
  const providerId = config.apiProviderId ?? null
  const model = models.find((item) => item.id === config.model)
  const modelEnv = selectedProviderModelEnv({ providers: providersFor(profile) }, providerId)
  const efforts = suggestedTaskEfforts(profile, config.model, providerId)
  return {
    models,
    efforts,
    providers: providersFor(profile),
    model: config.model ?? '',
    effort: config.effort ?? '',
    providerId,
    optionParams: [
      ...(profile.harnessId === 'claude' && supportsClaudeFastMode(model, modelEnv) ? [claudeFastModeOption(config.claudeFastMode === true)] : []),
      ...optionParamsForModel(profile.harnessId, model, {
        serviceTier: config.fastMode ? findCodexFastServiceTier(model)?.id ?? null : null,
      }),
    ],
  }
}

/**
 * Apply one edit the way the desktop launch control does. A new model keeps an
 * effort it can run and turns Fast off when it cannot; a mapped Claude
 * credential drops effort because that credential owns it.
 */
export function patchSuggestedTaskSettings(
  profile: SessionAgentProfile,
  current: SessionAgentLaunchSettings,
  displayed: SessionAgentLaunchConfig,
  patch: Partial<SessionAgentLaunchSettings>,
): SessionAgentLaunchSettings {
  const next: SessionAgentLaunchSettings = { ...current, ...patch }
  const providerId = 'apiProviderId' in patch ? patch.apiProviderId : displayed.apiProviderId
  const modelId = patch.model ?? displayed.model
  const model = profile.models.find((item) => item.id === modelId)
  const catalog = model ? catalogModel(model) : undefined
  const modelEnv = selectedProviderModelEnv({ providers: providersFor(profile) }, providerId)
  if (patch.model && patch.model !== displayed.model) {
    const effort = keptEffort(suggestedTaskEfforts(profile, patch.model, providerId), displayed.effort)
    if (effort) next.effort = effort
    else delete next.effort
    if (profile.harnessId === 'codex' && !findCodexFastServiceTier(catalog)) next.fastMode = false
    if (profile.harnessId === 'claude' && !supportsClaudeFastMode(catalog, modelEnv)) next.claudeFastMode = false
  }
  if ('apiProviderId' in patch && profile.harnessId === 'claude' && modelEnv) delete next.effort
  if ('apiProviderId' in patch && profile.harnessId === 'claude' && !supportsClaudeFastMode(catalog, modelEnv)) next.claudeFastMode = false
  return next
}
