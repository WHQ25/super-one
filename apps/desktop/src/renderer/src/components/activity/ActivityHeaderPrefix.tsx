import { useAppStore } from '@/stores/app'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useFullscreen } from '@/hooks/useFullscreen'
import { LayoutToggle } from '@/components/coding/LayoutToggle'
import { cn } from '@superone/ui/lib/utils'

/** Centralizes the activity tab header and empty-panel chrome placement. */
export function useActivityHeaderLayout() {
  const showSidebar = useAppStore(s => s.showSidebar)
  const side = useActivityPanelStore(s => s.side)
  const maximized = useActivityPanelStore(s => s.maximized)
  const isFullscreen = useFullscreen()
  const isMac = window.app.platform === 'darwin'
  return {
    hostsLayoutToggle: (maximized || side === 'left') && !(isMac && showSidebar),
    needsTrafficLightPadding: isMac && !isFullscreen && !showSidebar && (maximized || side === 'left'),
  }
}

export function ActivityHeaderPrefix() {
  const { hostsLayoutToggle, needsTrafficLightPadding } = useActivityHeaderLayout()
  if (!hostsLayoutToggle) return null
  return <div className={cn('flex h-full items-center', needsTrafficLightPadding && 'pl-2')}>
    {needsTrafficLightPadding && <div data-traffic-light-padding className="h-full w-[66px] shrink-0" />}
    <LayoutToggle />
  </div>
}
