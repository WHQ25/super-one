import type { HarnessId } from '@superone/shared/agent-types'

/**
 * Composer fields restored when opening a running session.
 *
 * `serviceTier` is always present for Codex so Fast-off (`null`) is distinct
 * from "the host default may fill". Other optional fields are omitted when the
 * session never set them, so the catalog default still applies.
 */
export type OpenedSessionSelection = {
  model?: string
  effort?: string
  permissionMode?: string
  serviceTier?: string | null
  apiProviderId?: string | null
  selectedModeId?: string | null
  selectedAgentId?: string | null
}

export type RestorableSessionSettings = {
  selectedModel?: string
  selectedEffort?: string
  selectedCodexModel?: string
  selectedCodexReasoningEffort?: string
  selectedCodexServiceTier?: string | null
  permissionMode?: string
  apiProviderId?: string | null
  selectedAcpModeId?: string | null
  openCodeAgentId?: string | null
}

export function openedSessionSelection(
  provider: HarnessId,
  session: RestorableSessionSettings,
): OpenedSessionSelection {
  const model = provider === 'codex' ? session.selectedCodexModel : session.selectedModel
  const effort = provider === 'codex' ? session.selectedCodexReasoningEffort : session.selectedEffort
  return {
    model: model ?? '',
    effort: effort ?? '',
    permissionMode: session.permissionMode ?? '',
    ...(provider === 'codex' ? { serviceTier: session.selectedCodexServiceTier ?? null } : {}),
    ...(session.apiProviderId ? { apiProviderId: session.apiProviderId } : {}),
    ...(session.selectedAcpModeId ? { selectedModeId: session.selectedAcpModeId } : {}),
    ...(session.openCodeAgentId ? { selectedAgentId: session.openCodeAgentId } : {}),
  }
}
