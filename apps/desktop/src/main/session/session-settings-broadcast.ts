import type { AgentEvent, SessionSettingsPatch } from '@superone/shared/agent-types'

/** Keep the durable model in step with Codex's harness-specific picker. */
export function broadcastSessionSettings(
  patch: SessionSettingsPatch,
  target: {
    harnessId: string
    setSelectedSettings: (settings: { model: string }) => void
    mergeUiSettings: (patch: SessionSettingsPatch) => void
    forwardEvent: (event: AgentEvent) => void
  },
): void {
  if (!patch || Object.keys(patch).length === 0) return
  target.mergeUiSettings(patch)
  if (target.harnessId === 'codex' && patch.selectedCodexModel) {
    target.setSelectedSettings({ model: patch.selectedCodexModel })
  }
  target.forwardEvent({ type: 'agent_setting_change', patch } as AgentEvent)
}
