import type { HarnessId, ModelOption, ProviderModelEnv, RemoteEffortOption, RemoteSystemInfo } from '@superone/shared/agent-types'
import { activeClaudeModelEnv } from '@superone/shared/claude-model-mapping'
import { formatEffortLabel } from '@superone/shared/effort-labels'

type ProviderCatalogInfo = Pick<RemoteSystemInfo, 'providers' | 'activeProvider'>

/**
 * The Claude slot mapping the picked credential runs under — what the desktop
 * computes from its settings store per session. The host ships it on each
 * provider row; `null` (host default) and the active credential fall back to
 * `activeProvider`, which is the same credential resolved through the global
 * binding. Non-empty only when at least one slot is actually remapped.
 */
export function selectedProviderModelEnv(
  info: ProviderCatalogInfo,
  providerId: string | null | undefined,
): ProviderModelEnv | null {
  const row = providerId ? info.providers?.find((provider) => provider.id === providerId) : undefined
  const env = row?.modelEnv
    ?? (!providerId || providerId === info.activeProvider?.id ? info.activeProvider?.modelEnv : undefined)
  return activeClaudeModelEnv(env)
}

export function resolveSelectedModel(info: RemoteSystemInfo, preferred = ''): string {
  const models = info.models ?? []
  if (preferred && models.some((model) => model.id === preferred)) return preferred
  const configured = info.defaults?.model
  if (configured && models.some((model) => model.id === configured)) return configured
  return models.find((model) => model.isDefault)?.id ?? models[0]?.id ?? ''
}

export function effortOptionsForModel(
  harnessId: HarnessId,
  info: RemoteSystemInfo,
  modelId: string,
  providerId: string | null = null,
): RemoteEffortOption[] {
  // A mapped provider owns the model/effort pairing in the host — but only a
  // provider that actually remaps models. A credential with no mapping still
  // runs the Claude catalog, and the desktop keeps effort for it.
  if (harnessId === 'claude' && selectedProviderModelEnv(info, providerId)) return []
  if (harnessId === 'acp') return info.efforts ?? []

  const model: ModelOption | undefined = info.models?.find((candidate) => candidate.id === modelId)
  if (!model) return []
  if (harnessId === 'codex') {
    return (model.supportedReasoningEfforts ?? []).map((option) => ({
      value: option.value,
      label: formatEffortLabel(option.value),
      ...(option.description ? { description: option.description } : {}),
    }))
  }
  return (model.supportedEffortLevels ?? []).map((value) => ({
    value,
    label: formatEffortLabel(value),
  }))
}

export function resolveSelectedEffort(
  options: RemoteEffortOption[],
  preferred?: string | null,
): string {
  if (preferred && options.some((option) => option.value === preferred)) return preferred
  return options.find((option) => option.value === 'medium')?.value
    ?? options[0]?.value
    ?? ''
}

