import type { AgentEvent } from '@superone/shared/agent-types'
import type { PerSessionState } from '../types'

const selectionKeys = [
  'selectedCodexModel',
  'selectedCodexReasoningEffort',
  'selectedCodexServiceTier',
  'codexModelUserChosen',
  'codexReasoningEffortUserChosen',
] as const

/** Protect a pick made after the snapshot request began, including its replay. */
export function changedCodexSelection(
  before: PerSessionState | undefined,
  current: PerSessionState | undefined,
): Partial<PerSessionState> | undefined {
  if (!current) return undefined
  if (!selectionKeys.some((key) => before?.[key] !== current[key])) return undefined
  return {
    selectedCodexModel: current.selectedCodexModel,
    selectedCodexReasoningEffort: current.selectedCodexReasoningEffort,
    selectedCodexServiceTier: current.selectedCodexServiceTier,
    codexModelUserChosen: current.codexModelUserChosen,
    codexReasoningEffortUserChosen: current.codexReasoningEffortUserChosen,
  }
}

export function omitCodexSelectionReplay(event: AgentEvent): AgentEvent {
  if (event.type !== 'agent_setting_change' || !event.patch) return event
  return {
    ...event,
    patch: {
      ...event.patch,
      selectedCodexModel: undefined,
      selectedCodexReasoningEffort: undefined,
      selectedCodexServiceTier: undefined,
    },
  }
}
