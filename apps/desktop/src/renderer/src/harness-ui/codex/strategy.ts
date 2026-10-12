import type { CodexReasoningEffort } from '@superone/shared/agent-types'
import type { PerSessionState } from '@/stores/chat-store/types'
import { resolveDefaultCodexSelection, resolveSessionCodexSelection } from '@/stores/chat-store/helpers/codex-helpers'
import { changedCodexSelection } from '@/stores/chat-store/helpers/codex-selection-replay'
import type { HarnessStrategy, SelectionAccess } from '../strategy'

/** Codex keeps its pick apart from the neutral fields; the wire and persistence carry these names. */
const codexSelection: SelectionAccess = {
  read: (session) => ({
    model: session.selectedCodexModel,
    effort: session.selectedCodexReasoningEffort,
    modelUserChosen: session.codexModelUserChosen,
    effortUserChosen: session.codexReasoningEffortUserChosen,
  }),
  patch: (change, flags = {}) => ({
    ...(change.model !== undefined ? { selectedCodexModel: change.model ?? '' } : {}),
    ...(change.effort !== undefined ? { selectedCodexReasoningEffort: (change.effort ?? undefined) as CodexReasoningEffort | undefined } : {}),
    ...(flags.modelUserChosen !== undefined ? { codexModelUserChosen: flags.modelUserChosen } : {}),
    ...(flags.effortUserChosen !== undefined ? { codexReasoningEffortUserChosen: flags.effortUserChosen } : {}),
  }),
}

export const codexStrategy: HarnessStrategy = {
  selection: codexSelection,
  seed: (session, { project }) => {
    const selection = resolveDefaultCodexSelection(project.codexModels)
    session.selectedCodexModel = selection.modelId
    session.selectedCodexReasoningEffort = selection.reasoningEffort
    session.selectedCodexServiceTier = selection.serviceTier
  },
  missingDefaults: (session, project) => {
    const selection = resolveSessionCodexSelection(project.codexModels, session.selectedCodexModel, session.selectedCodexReasoningEffort)
    const patch: Partial<PerSessionState> = {}
    if (selection.modelId !== session.selectedCodexModel) patch.selectedCodexModel = selection.modelId
    if (selection.reasoningEffort !== session.selectedCodexReasoningEffort) patch.selectedCodexReasoningEffort = selection.reasoningEffort
    if (selection.serviceTier !== undefined && selection.serviceTier !== session.selectedCodexServiceTier) patch.selectedCodexServiceTier = selection.serviceTier
    return patch
  },
  /**
   * Main persists the running model in harness-neutral fields. A live restore
   * needs the same Codex mapping as DB hydration, keeping a picker choice made
   * since the last turn ahead of that running-model fallback.
   */
  liveRestore: ({ previous, stored, atRequest, fromUi, snapshot }) => {
    const next: Partial<PerSessionState> = { ...fromUi }
    next.selectedCodexModel ||= (previous.codexModelUserChosen ? previous.selectedCodexModel : '')
      || snapshot.selectedModel || fromUi.selectedModel || previous.selectedCodexModel || ''
    next.selectedCodexReasoningEffort ??= (previous.codexReasoningEffortUserChosen ? previous.selectedCodexReasoningEffort : undefined)
      ?? (snapshot.selectedEffort as CodexReasoningEffort | null | undefined)
      ?? fromUi.selectedEffort ?? previous.selectedCodexReasoningEffort
    if (next.selectedCodexModel) next.codexModelUserChosen = true
    if (next.selectedCodexReasoningEffort) next.codexReasoningEffortUserChosen = true
    return { fromUi: next, newer: changedCodexSelection(atRequest, stored) }
  },
  prewarmHint: (session) => ({ model: session.selectedCodexModel || undefined }),
  runModel: (session, project) => {
    const codex = resolveSessionCodexSelection(project.codexModels, session.selectedCodexModel, session.selectedCodexReasoningEffort)
    return { model: codex.modelId || undefined, effort: codex.reasoningEffort ?? undefined }
  },
  turnSettings: ({ session, current, turn }) => ({
    portable: {
      turnKind: turn.turnKind ?? 'run',
      ...(session.selectedCodexCollaborationMode ? { collaborationMode: session.selectedCodexCollaborationMode } : {}),
    },
    desktop: {
      ...(session.selectedCodexPermissionPreset ? { permissionPreset: session.selectedCodexPermissionPreset } : {}),
      serviceTier: session.selectedCodexServiceTier,
      ...(current._providerSessionId ? { threadId: current._providerSessionId } : {}),
    },
  }),
  draftSettings: (session) => ({
    serviceTier: session.selectedCodexServiceTier,
    permissionPreset: session.selectedCodexPermissionPreset,
    collaborationMode: session.selectedCodexCollaborationMode,
  }),
}
