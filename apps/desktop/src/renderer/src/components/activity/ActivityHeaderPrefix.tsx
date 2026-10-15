import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from 'react'
import type { DockviewApi, IDockviewGroupPanel } from 'dockview-core'
import { useAppStore } from '@/stores/app'
import { selectPanelFillsWindow, useActivityPanelStore } from '@/stores/activity-panel'
import { useFullscreen } from '@/hooks/useFullscreen'
import { LayoutToggle } from '@/components/coding/LayoutToggle'
import { cn } from '@superone/ui/lib/utils'

const HeaderGroupContext = createContext<string | null>(null)

/** macOS window controls belong to the visible top-left group, not every tab strip. */
export function ActivityHeaderGroupProvider({ api: dockApi, children }: { api: DockviewApi | null; children: ReactNode }) {
  const api = window.app.platform === 'darwin' ? dockApi : null
  const subscribe = useCallback((onChange: () => void) => {
    if (!api) return () => {}
    const subscriptions = [api.onDidLayoutChange(onChange), api.onDidMaximizedGroupChange(onChange)]
    return () => subscriptions.forEach((subscription) => subscription.dispose())
  }, [api])
  const getGroupId = useCallback(() => {
    if (!api) return null
    const maximized = api.groups.find((group) => group.api.isMaximized())
    if (maximized) return maximized.id

    // The first visible child on either split axis leads to the top-left leaf.
    // Group creation order and the active group need not match this position.
    let node = api.toJSON().grid.root
    while (Array.isArray(node.data)) {
      const child = node.data.find((entry) => entry.visible !== false)
      if (!child) return null
      node = child
    }
    return node.data.id
  }, [api])
  const groupId = useSyncExternalStore(subscribe, getGroupId)
  return <HeaderGroupContext.Provider value={groupId}>{children}</HeaderGroupContext.Provider>
}

/** Centralizes the activity tab header and empty-panel chrome placement. */
export function useActivityHeaderLayout() {
  const showSidebar = useAppStore(s => s.showSidebar)
  const side = useActivityPanelStore(s => s.side)
  const fillsWindow = useActivityPanelStore(selectPanelFillsWindow)
  const isFullscreen = useFullscreen()
  const isMac = window.app.platform === 'darwin'
  return {
    isMac,
    hostsLayoutToggle: (fillsWindow || side === 'left') && !(isMac && showSidebar),
    needsTrafficLightPadding: isMac && !isFullscreen && !showSidebar && (fillsWindow || side === 'left'),
  }
}

export function ActivityHeaderPrefix({ group }: { group?: IDockviewGroupPanel }) {
  const headerGroupId = useContext(HeaderGroupContext)
  const { isMac, hostsLayoutToggle, needsTrafficLightPadding } = useActivityHeaderLayout()
  if (!hostsLayoutToggle || (isMac && group && group.id !== headerGroupId)) return null
  return <div className={cn('flex h-full items-center', needsTrafficLightPadding && 'pl-2')}>
    {needsTrafficLightPadding && <div data-traffic-light-padding className="h-full w-[66px] shrink-0" />}
    <LayoutToggle />
  </div>
}
