import type { AgentEvent, SendMessageRequest, SessionSettingsPatch } from '@superone/shared/agent-types'

/** Keep durable model and effort in step with Codex's harness-specific picker. */
export function broadcastSessionSettings(
  patch: SessionSettingsPatch,
  target: {
    harnessId: string
    setSelectedSettings: (settings: { model?: string; effort?: SendMessageRequest['effort'] | null }) => void
    mergeUiSettings: (patch: SessionSettingsPatch) => void
    forwardEvent: (event: AgentEvent) => void
  },
): void {
  if (!patch || Object.keys(patch).length === 0) return
  target.mergeUiSettings(patch)
  if (target.harnessId === 'codex' && (patch.selectedCodexModel || patch.selectedCodexReasoningEffort !== undefined)) {
    target.setSelectedSettings({
      ...(patch.selectedCodexModel ? { model: patch.selectedCodexModel } : {}),
      ...(patch.selectedCodexReasoningEffort !== undefined
        ? { effort: patch.selectedCodexReasoningEffort as SendMessageRequest['effort'] | null }
        : {}),
    })
  }
  target.forwardEvent({ type: 'agent_setting_change', patch } as AgentEvent)
}
