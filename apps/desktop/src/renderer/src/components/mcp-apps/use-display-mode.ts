import { useCallback } from 'react'
import type { McpAppHostExecutor } from '@superone/shared/mcp-apps-host'
import { useMcpAppLayout } from './layout-store'
export type McpAppDisplayMode = 'inline' | 'fullscreen' | 'pip'
export function useMcpAppDisplayMode(key: string) {
  const surface = useMcpAppLayout(state => state.views[key]?.mode ?? 'inline')
  const mode = surface
  const request = useCallback<McpAppHostExecutor['requestDisplayMode']>(async (next, signal) => {
    if (signal.aborted) return 'inline'
    if (next === 'pip') useMcpAppLayout.getState().setMode(key, next)
    else {
      const { closeMcpAppTab, openMcpAppTab } = await import('@/components/activity/activity-panel-api')
      if (signal.aborted) return 'inline'
      if (next === 'fullscreen') openMcpAppTab(key)
      else closeMcpAppTab(key)
    }
    return next
  }, [key])
  /** Host-initiated: the user's header action, not a View request. */
  const open = useCallback(async (maximized: boolean) => {
    const { openMcpAppTab } = await import('@/components/activity/activity-panel-api')
    openMcpAppTab(key, maximized)
  }, [key])
  return { mode, surface, request, open }
}
