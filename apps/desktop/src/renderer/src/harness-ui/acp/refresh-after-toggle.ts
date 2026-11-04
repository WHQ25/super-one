import type { HarnessId } from '@superone/shared/session-types'
import { useChatStore } from '@/stores/chat'

/**
 * Reload ACP agents and models after a settings toggle.
 * Returns true when `provider` is ACP, so the caller does not also
 * reinitialize a non-ACP harness. The harness-id compare stays in this
 * module; the settings page is under the branch ratchet.
 */
export async function refreshAcpResourcesAfterToggle(
  provider: HarnessId,
  acpAgentId: string | null,
  enabled: boolean,
): Promise<boolean> {
  if (provider !== 'acp') return false
  try {
    const listed = await window.app.listAcpAgents?.()
    if (listed) useChatStore.getState().setHarnessResources('acp', listed)
  } catch {
    /* best-effort */
  }
  if (enabled && acpAgentId) {
    void window.app.refreshAcpModels?.(acpAgentId)
      .then((fresh) => {
        if (fresh) useChatStore.getState().setHarnessResources('acp', fresh)
      })
      .catch(() => {
        /* best-effort */
      })
  }
  return true
}
