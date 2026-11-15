import type { EffortLevel, ModelOption, RemoteEffortOption, RemoteModeOption } from '../agent-types'
import { formatEffortOptionLabel, isAcpEffortConfigId, sortEffortsAscending } from '../effort-labels'

export interface AcpModeSource {
  modes: ModelOption[]
  modeConfigId: string | null
  selectedModeId: string | null
}

export interface AcpModeProjection {
  efforts: RemoteEffortOption[]
  modes: RemoteModeOption[]
  selectedModeId: string | null
}

const ORDERED_ACP_EFFORT_LEVELS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']
const ACP_PERMISSION_MODE_VALUES = new Set([
  'default',
  'accept-edits',
  'acceptEdits',
  'auto',
  'plan',
  'bypassPermissions',
])

export function isAcpPermissionModeValues(values: readonly string[]): boolean {
  if (values.length === 0) return false
  const hasPermissionSpecific = values.some(
    (value) => value === 'accept-edits' || value === 'acceptEdits' || value === 'bypassPermissions',
  )
  return hasPermissionSpecific && values.every((value) => ACP_PERMISSION_MODE_VALUES.has(value))
}

function overlaySingleAcpModel(primary: ModelOption, extra: ModelOption | undefined): ModelOption {
  if (!extra) return primary
  return {
    ...primary,
    ...(primary.contextWindow == null && extra.contextWindow != null
      ? { contextWindow: extra.contextWindow }
      : {}),
    ...(primary.supportsEffort == null && extra.supportsEffort != null
      ? { supportsEffort: extra.supportsEffort }
      : {}),
    ...(primary.supportedEffortLevels == null && extra.supportedEffortLevels != null
      ? { supportedEffortLevels: extra.supportedEffortLevels }
      : {}),
    ...(primary.contextWindows == null && extra.contextWindows != null
      ? { contextWindows: extra.contextWindows }
      : {}),
  }
}

export function overlayAcpModelList(
  primary: readonly ModelOption[],
  extras: readonly ModelOption[],
): ModelOption[] {
  if (extras.length === 0 || primary.length === 0) return [...primary]
  const byId = new Map(extras.map((model) => [model.id, model]))
  const extraIds = new Set(byId.keys())
  const hasSuffixedCatalog = primary.some((model) =>
    ORDERED_ACP_EFFORT_LEVELS.some((effort) => extraIds.has(`${model.id}-${effort}`)),
  )

  return primary.map((model) => {
    const overlaid = overlaySingleAcpModel(model, byId.get(model.id))
    if (!hasSuffixedCatalog || overlaid.supportsEffort != null || overlaid.supportedEffortLevels != null) {
      return overlaid
    }
    const suffixedLevels = ORDERED_ACP_EFFORT_LEVELS.filter((effort) =>
      extraIds.has(`${model.id}-${effort}`),
    )
    const firstSuffixed = suffixedLevels.length > 0 ? byId.get(`${model.id}-${suffixedLevels[0]}`) : undefined
    return {
      ...overlaid,
      ...(overlaid.contextWindow == null && firstSuffixed?.contextWindow != null
        ? { contextWindow: firstSuffixed.contextWindow }
        : {}),
      ...(overlaid.contextWindows == null && firstSuffixed?.contextWindows != null
        ? { contextWindows: firstSuffixed.contextWindows }
        : {}),
      supportsEffort: suffixedLevels.length > 0,
      supportedEffortLevels: suffixedLevels,
    }
  })
}

export function acpModeCatalog(source: AcpModeSource | null): AcpModeProjection {
  const modes = source?.modes ?? []
  if (modes.length === 0) return { efforts: [], modes: [], selectedModeId: null }

  if (isAcpEffortConfigId(source!.modeConfigId)) {
    const efforts = sortEffortsAscending(modes.map((mode) => ({
      value: mode.id,
      label: formatEffortOptionLabel(mode.name || mode.id),
      ...(mode.description ? { description: mode.description } : {}),
    })))
    return { efforts, modes: [], selectedModeId: null }
  }

  return {
    efforts: [],
    modes: modes.map((mode) => ({
      id: mode.id,
      name: mode.name || mode.id,
      ...(mode.description ? { description: mode.description } : {}),
    })),
    selectedModeId: source!.selectedModeId ?? modes[0]?.id ?? null,
  }
}

export function acpEffortOptionsForModel(
  models: readonly ModelOption[],
  modelId: string | null | undefined,
  fallbackEfforts: readonly RemoteEffortOption[],
): RemoteEffortOption[] {
  const model = modelId ? models.find((entry) => entry.id === modelId) : undefined
  if (model?.supportsEffort === false) return []
  if (model?.supportedEffortLevels !== undefined) {
    if (model.supportedEffortLevels.length === 0) return []
    return sortEffortsAscending(
      model.supportedEffortLevels.map((value) => {
        const matched = fallbackEfforts.find((entry) => entry.value === value)
        return {
          value,
          label: matched?.label ?? formatEffortOptionLabel(value),
          ...(matched?.description ? { description: matched.description } : {}),
        }
      }),
    )
  }
  return [...fallbackEfforts]
}

export function clampAcpEffortForModel(
  effortOptions: readonly RemoteEffortOption[],
  preferredEffort: string | null | undefined,
): string | null {
  if (effortOptions.length === 0) return null
  if (preferredEffort && effortOptions.some((opt) => opt.value === preferredEffort)) {
    return preferredEffort
  }
  if (preferredEffort === 'xhigh' || preferredEffort === 'max') {
    const high = effortOptions.find((opt) => opt.value === 'high')
    if (high) return high.value
  }
  return (
    effortOptions.find((opt) => opt.value === 'medium')?.value
    ?? effortOptions.find((opt) => opt.value === 'high')?.value
    ?? effortOptions[0]?.value
    ?? null
  )
}
