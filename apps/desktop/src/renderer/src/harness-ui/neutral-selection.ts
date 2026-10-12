import type { EffortLevel } from '@superone/shared/agent-types'
import type { SelectionAccess } from './strategy'

/** `selectedModel` / `selectedEffort`: every harness except Codex keeps its pick here. */
export const neutralSelection: SelectionAccess = {
  read: (session) => ({
    model: session.selectedModel,
    effort: session.selectedEffort,
    modelUserChosen: session.modelUserChosen,
    effortUserChosen: session.effortUserChosen,
  }),
  patch: (change, flags = {}) => ({
    ...(change.model !== undefined ? { selectedModel: change.model ?? '' } : {}),
    ...(change.effort !== undefined ? { selectedEffort: (change.effort ?? undefined) as EffortLevel | undefined } : {}),
    ...(flags.modelUserChosen !== undefined ? { modelUserChosen: flags.modelUserChosen } : {}),
    ...(flags.effortUserChosen !== undefined ? { effortUserChosen: flags.effortUserChosen } : {}),
  }),
}
