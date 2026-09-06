import type { HarnessId, ModelOption, RemoteEffortOption, RemoteSystemInfo } from '@superone/shared/agent-types'
import { formatEffortLabel } from '@superone/shared/effort-labels'

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
): RemoteEffortOption[] {
  // A mapped provider owns the model/effort pairing in the host — but only a
  // provider that actually remaps models. A credential with no mapping still
  // runs the Claude catalog, and the desktop keeps effort for it.
  if (harnessId === 'claude' && Object.keys(info.activeProvider?.modelEnv ?? {}).length > 0) return []
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

