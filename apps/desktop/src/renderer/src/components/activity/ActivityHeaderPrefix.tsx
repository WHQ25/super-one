import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from 'react'
import type { DockviewApi, IDockviewGroupPanel } from 'dockview-core'
import { useAppStore } from '@/stores/app'
import { selectPanelFillsWindow, useActivityPanelStore } from '@/stores/activity-panel'
import { useFullscreen } from '@/hooks/useFullscreen'
import { useLayoutControlsWidth } from '@/components/coding/LayoutToggle'
import { CARD_HEADER_CHROME } from '@/lib/layout-constants'
import { cn } from '@superone/ui/lib/utils'

const HeaderGroupContext = createContext<string | null>(null)

/** macOS window controls belong to the visible top-left group, not every tab strip. */
export function ActivityHeaderGroupProvider({ api: dockApi, children }: { api: DockviewApi | null; children: ReactNode }) {
  const api = window.app.platform !== 'win32' ? dockApi : null
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
  const isWin = window.app.platform === 'win32'
  return {
    isMac,
    hostsLayoutToggle: !isWin && (fillsWindow || side === 'left') && !(isMac && showSidebar),
    needsTrafficLightPadding: isMac && !isFullscreen && !showSidebar && (fillsWindow || side === 'left'),
  }
}

export function ActivityHeaderPrefix({ group }: { group?: IDockviewGroupPanel }) {
  const headerGroupId = useContext(HeaderGroupContext)
  const { hostsLayoutToggle, needsTrafficLightPadding } = useActivityHeaderLayout()
  const controlsWidth = useLayoutControlsWidth()
  if (!hostsLayoutToggle || (group && group.id !== headerGroupId)) return null
  return (
    <div
      data-activity-controls-spacer=""
      className={cn('flex h-full shrink-0 items-center', needsTrafficLightPadding ? CARD_HEADER_CHROME.MAC_PADDING_LEFT : 'pl-2')}
    >
      {needsTrafficLightPadding && <div data-traffic-light-padding className={cn('h-full shrink-0', CARD_HEADER_CHROME.TRAFFIC_LIGHT_SPACER)} />}
      <div data-layout-controls-spacer="" className="h-full shrink-0" style={{ width: controlsWidth }} />
    </div>
  )
}
