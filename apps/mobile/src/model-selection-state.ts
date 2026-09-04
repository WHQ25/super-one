import type { HarnessId, ModelOption, RemoteEffortOption, RemoteSystemInfo } from '@superone/shared/agent-types'

function labelForEffort(value: string): string {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
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
): RemoteEffortOption[] {
  // Claude-compatible API mappings own their model/effort pairing in the host.
  if (harnessId === 'claude' && info.activeProvider) return []
  if (harnessId === 'acp') return info.efforts ?? []

  const model: ModelOption | undefined = info.models?.find((candidate) => candidate.id === modelId)
  if (!model) return []
  if (harnessId === 'codex') {
    return (model.supportedReasoningEfforts ?? []).map((option) => ({
      value: option.value,
      label: labelForEffort(option.value),
      ...(option.description ? { description: option.description } : {}),
    }))
  }
  return (model.supportedEffortLevels ?? []).map((value) => ({
    value,
    label: labelForEffort(value),
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

