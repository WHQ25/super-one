import { useCallback, useEffect, useState } from 'react'
import type { McpAppHostExecutor } from '@superone/shared/mcp-apps-host'
import { openMcpAppTab, getDockApi } from '@/components/activity/activity-panel-api'
import { useMcpAppLayout } from './layout-store'
export type McpAppDisplayMode = 'inline' | 'fullscreen' | 'pip'
export function useMcpAppDisplayMode(key: string, title: string) {
  const [mode, setMode] = useState<McpAppDisplayMode>('inline')
  const [modes, setModes] = useState<McpAppDisplayMode[]>(['inline'])
  const request = useCallback<McpAppHostExecutor['requestDisplayMode']>(async (next, signal) => {
    if (signal.aborted) return 'inline'
    if (next === 'fullscreen') openMcpAppTab(key, title)
    setMode(next)
    return next
  }, [key, title])
  useEffect(() => {
    const release = useMcpAppLayout.getState().own(key, () => setMode('inline'))
    return () => { release(); getDockApi()?.getPanel(`mcp-app:${key}`)?.api.close() }
  }, [key])
  return { mode, modes, setModes, request }
}
