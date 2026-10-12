import type { ModelOption, RemoteEffortOption, RemoteModeOption } from '../agent-types'
import { formatEffortOptionLabel, isAcpEffortConfigId, sortEffortsAscending } from '../effort-labels'

export interface AcpModeSource {
  modes: ModelOption[]
  /** `null` or `reasoning_effort` means Grok reasoning effort. Other ids are session modes. */
  modeConfigId: string | null
  selectedModeId: string | null
}

export interface AcpModeProjection {
  efforts: RemoteEffortOption[]
  modes: RemoteModeOption[]
  selectedModeId: string | null
}

/**
 * Split an ACP mode catalog into reasoning effort and real session modes. Every
 * surface that shows an ACP model picker (composer, launch rows, agent profiles,
 * Remote Control) reads it through here. Sending real session modes as effort
 * used to draw a slider for `ask`/`code`, which the backend then dropped, because
 * only `low…max` survive `asGrokReasoningEffort`.
 * Grok's live catalog uses config id `reasoning_effort` (category `thought_level`).
 */
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
