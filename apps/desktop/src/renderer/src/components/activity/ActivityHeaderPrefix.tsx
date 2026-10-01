import { useAppStore } from '@/stores/app'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useFullscreen } from '@/hooks/useFullscreen'
import { LayoutToggle } from '@/components/coding/LayoutToggle'
import { cn } from '@superone/ui/lib/utils'

/** Activity and MCP fullscreen share the same native-window chrome placement. */
export function useActivityHeaderLayout(maximizedOverride?: boolean) {
  const showSidebar = useAppStore(s => s.showSidebar)
  const side = useActivityPanelStore(s => s.side)
  const panelMaximized = useActivityPanelStore(s => s.maximized)
  const maximized = maximizedOverride ?? panelMaximized
  const isFullscreen = useFullscreen()
  const isMac = window.app.platform === 'darwin'
  return {
    hostsLayoutToggle: (maximized || side === 'left') && !(isMac && showSidebar),
    needsTrafficLightPadding: isMac && !isFullscreen && !showSidebar && (maximized || side === 'left'),
  }
}

export function ActivityHeaderPrefix({ maximized }: { maximized?: boolean }) {
  const { hostsLayoutToggle, needsTrafficLightPadding } = useActivityHeaderLayout(maximized)
  if (!hostsLayoutToggle) return null
  return <div className={cn('flex h-full items-center', needsTrafficLightPadding && 'pl-2')}>
    {needsTrafficLightPadding && <div data-traffic-light-padding className="h-full w-[66px] shrink-0" />}
    <LayoutToggle maximized={maximized} />
  </div>
}
