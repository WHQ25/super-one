import type { AgentEvent, CodexReasoningEffort, SendMessageRequest, SessionSettingsPatch } from '@superone/shared/agent-types'

/** Keep durable model and effort in step with Codex's harness-specific picker. */
export function broadcastSessionSettings(
  patch: SessionSettingsPatch,
  target: {
    harnessId: string
    setSelectedSettings: (settings: { model?: string; effort?: SendMessageRequest['effort'] | null }) => void
    setCodexSelection?: (selection: {
      model?: string | null
      reasoningEffort?: CodexReasoningEffort | null
      serviceTier?: string | null
    }) => void
    mergeUiSettings: (patch: SessionSettingsPatch) => void
    forwardEvent: (event: AgentEvent) => void
  },
): void {
  if (!patch || Object.keys(patch).length === 0) return
  target.mergeUiSettings(patch)
  const hasCodexSelection = target.harnessId === 'codex' && (
    patch.selectedCodexModel !== undefined
    || patch.selectedCodexReasoningEffort !== undefined
    || patch.selectedCodexServiceTier !== undefined
  )
  if (hasCodexSelection) {
    target.setSelectedSettings({
      ...(patch.selectedCodexModel ? { model: patch.selectedCodexModel } : {}),
      ...(patch.selectedCodexReasoningEffort !== undefined
        ? { effort: patch.selectedCodexReasoningEffort as SendMessageRequest['effort'] | null }
        : {}),
    })
    target.setCodexSelection?.({
      ...(patch.selectedCodexModel !== undefined ? { model: patch.selectedCodexModel } : {}),
      ...(patch.selectedCodexReasoningEffort !== undefined
        ? { reasoningEffort: patch.selectedCodexReasoningEffort as CodexReasoningEffort | null }
        : {}),
      ...(patch.selectedCodexServiceTier !== undefined ? { serviceTier: patch.selectedCodexServiceTier } : {}),
    })
  }
  target.forwardEvent({ type: 'agent_setting_change', patch } as AgentEvent)
}
