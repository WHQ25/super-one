import { useEffect, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-core'
import { useSlotBounds } from '@/hooks/useSlotBounds'
import { useMcpAppLayout } from './layout-store'

/** Activity panel reports its viewport; the chat-owned iframe never moves in the DOM. */
export function McpAppPanel({ params, api }: IDockviewPanelProps<{ appInstanceId: string }>) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(api.isVisible)
  useEffect(() => { const sub = api.onDidVisibilityChange(event => setVisible(event.isVisible)); return () => sub.dispose() }, [api])
  useSlotBounds(ref, `${params.appInstanceId}:${visible}`, bounds => useMcpAppLayout.getState().updateSlot(params.appInstanceId, { bounds, visible }), () => useMcpAppLayout.getState().updateSlot(params.appInstanceId))
  return <div ref={ref} className="h-full w-full" data-mcp-app-panel={params.appInstanceId} />
}
