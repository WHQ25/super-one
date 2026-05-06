import { useEffect, useRef } from 'react'

interface ExpandedSidebarTrace {
  folderPath: string
  cachedCount: number
  hiddenCount: number
  inMemoryCount: number
  liveCount: number
  unseenCount: number
  activeSessionId: string | null
}

interface SidebarRenderTraceState {
  sidebarTab: string
  currentFolder: string | null
  recentFolderCount: number
  pinnedCount: number
  expanded: ExpandedSidebarTrace[]
}

const SIDEBAR_TRACE_ENABLED = import.meta.env.DEV && import.meta.env.RENDERER_VITE_SIDEBAR_TRACE === '1'

export function traceSidebar(type: string, data: Record<string, unknown>, tag?: string): void {
  if (!SIDEBAR_TRACE_ENABLED) return
  window.app.trace?.('sidebar.ui', type, data, tag)
}

export function useSidebarRenderTrace(state: SidebarRenderTraceState): void {
  const renderCountRef = useRef(0)
  const lastTraceAtRef = useRef(typeof performance !== 'undefined' ? performance.now() : 0)

  useEffect(() => {
    if (!SIDEBAR_TRACE_ENABLED || state.sidebarTab !== 'sessions' || state.expanded.length === 0) return
    const now = typeof performance !== 'undefined' ? performance.now() : 0
    renderCountRef.current += 1
    traceSidebar('render', {
      renderCount: renderCountRef.current,
      sinceLastMs: Math.round((now - lastTraceAtRef.current) * 100) / 100,
      currentFolder: state.currentFolder,
      recentFolderCount: state.recentFolderCount,
      pinnedCount: state.pinnedCount,
      expanded: state.expanded,
    })
    lastTraceAtRef.current = now
  }, [state])
}
