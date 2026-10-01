import { useCallback } from 'react'
import type { IDockviewPanelProps } from 'dockview-core'
import { useMcpAppLayout } from './layout-store'

/** The document is owned outside Dockview; this panel only supplies a destination. */
export function McpAppPanel({ params }: IDockviewPanelProps<{ appInstanceId: string }>) {
  const ref = useCallback((element: HTMLDivElement | null) => useMcpAppLayout.getState().surface(params.appInstanceId, 'fullscreen', element), [params.appInstanceId])
  return <div ref={ref} data-mcp-app-fullscreen={params.appInstanceId} className="h-full w-full overflow-hidden" />
}
