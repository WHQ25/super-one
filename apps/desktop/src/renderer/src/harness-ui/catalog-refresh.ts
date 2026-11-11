import { useCallback, useState } from 'react'
import type { HarnessId } from '@superone/shared/agent-types'
import { useChatStore } from '@/stores/chat'
import { isClaudeHarness } from './claude/is-claude-harness'

/** Which refresh button a launch model list shows. A remote snapshot uses the parent's. */
export function pickLaunchRefresh(
  profileOnly: boolean,
  own: { onRefreshModels?: () => void; modelsLoading?: boolean },
  parent: { onRefreshModels?: () => void; modelsLoading?: boolean },
): { onRefreshModels?: () => void; modelsLoading?: boolean } {
  if (profileOnly) return parent
  return {
    onRefreshModels: own.onRefreshModels ?? parent.onRefreshModels,
    modelsLoading: own.modelsLoading || parent.modelsLoading,
  }
}

/**
 * Re-probe the local catalog the composer already refreshes.
 * Codex lists models per API key, so its launch control refreshes itself.
 */
export function useHarnessCatalogRefresh(harnessId: Exclude<HarnessId, 'codex'>, enabled: boolean): {
  onRefreshModels?: () => void
  modelsLoading?: boolean
} {
  const initializeHarness = useChatStore((state) => state.initializeHarness)
  const refreshClaudeResources = useChatStore((state) => state.refreshClaudeResources)
  const claudeLoading = useChatStore((state) => state.claudeResourcesLoading)
  const [loading, setLoading] = useState(false)
  const refresh = useCallback(() => {
    if (isClaudeHarness(harnessId)) {
      void refreshClaudeResources(true)
      return
    }
    setLoading(true)
    void initializeHarness(harnessId, { force: true }).finally(() => setLoading(false))
  }, [harnessId, initializeHarness, refreshClaudeResources])
  if (!enabled) return {}
  return {
    onRefreshModels: refresh,
    modelsLoading: isClaudeHarness(harnessId) ? claudeLoading : loading,
  }
}
