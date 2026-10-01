import { useCallback } from 'react'
import type { McpAppHostExecutor } from '@superone/shared/mcp-apps-host'
import { useMcpAppLayout } from './layout-store'
import { closeMcpAppTab, openMcpAppTab } from '@/components/activity/activity-panel-api'
export type McpAppDisplayMode = 'inline' | 'fullscreen' | 'pip'
export function useMcpAppDisplayMode(key: string) {
  const surface = useMcpAppLayout(state => state.views[key]?.mode ?? 'inline')
  const mode = surface
  const request = useCallback<McpAppHostExecutor['requestDisplayMode']>(async (next, signal) => {
    if (signal.aborted) return 'inline'
    if (next === 'fullscreen') openMcpAppTab(key)
    else if (next === 'inline') closeMcpAppTab(key)
    else useMcpAppLayout.getState().setMode(key, next)
    return next
  }, [key])
  return { mode, surface, request }
}
