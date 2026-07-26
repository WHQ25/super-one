import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelLeft, PanelRight, PanelTop, PanelBottom, SquarePlus } from 'lucide-react'
import { useMiniAppStore } from '@/stores/miniapp'
import { useActivityDropStore, type DropPosition } from '@/stores/activity-drop'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useAppStore } from '@/stores/app'
import { useSashResizing } from '@/hooks/useSashResizing'
import { useGlobalDragging } from '@/hooks/useGlobalDragging'
import { useFullscreen } from '@/hooks/useFullscreen'
import { useShallow } from 'zustand/react/shallow'
import { MiniAppView } from './MiniAppView'

const DROP_GUIDE_ICON: Record<DropPosition, typeof PanelLeft> = {
  left: PanelLeft,
  right: PanelRight,
  top: PanelTop,
  bottom: PanelBottom,
  center: SquarePlus,
}

function DropGuide({ position }: { position: DropPosition }) {
  const { t } = useTranslation()
  const Icon = DROP_GUIDE_ICON[position]
  return (
    <div className="flex flex-col items-center gap-1.5 text-primary">
      <Icon className="size-5 shrink-0" />
      <span className="text-xs font-medium">{t(`resources.apps.dropHint.${position}`)}</span>
    </div>
  )
}

export function MiniAppHostLayer() {
  const openInstanceKeys = useMiniAppStore(useShallow((s) => Object.keys(s.openApps)))
  const globalDragging = useGlobalDragging()
  const sashResizing = useSashResizing()
  const dragging = globalDragging || sashResizing
  const indicator = useActivityDropStore((s) => s.indicator)

  useEffect(() => {
    if (!dragging) useActivityDropStore.getState().setIndicator(null)
  }, [dragging])

  return (
    <div
      data-miniapp-host-layer=""
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 30,
      }}
    >
      {openInstanceKeys.map((instanceKey) => (
        <PersistentMiniAppContainer key={instanceKey} instanceKey={instanceKey} dragging={dragging} />
      ))}
      {dragging && indicator && (
        <div
          data-activity-drop-indicator=""
          className="activity-drop-indicator"
          style={{
            position: 'absolute',
            left: indicator.left,
            top: indicator.top,
            width: indicator.width,
            height: indicator.height,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width={indicator.width} height={indicator.height}>
            <rect x={1} y={1} width={indicator.width - 2} height={indicator.height - 2} rx={10} ry={10} />
          </svg>
          <DropGuide position={indicator.position} />
        </div>
      )}
    </div>
  )
}

function PersistentMiniAppContainer({ instanceKey, dragging }: { instanceKey: string; dragging: boolean }) {
  const slot = useMiniAppStore((s) => s.slots[instanceKey])
  const activitySide = useActivityPanelStore((s) => s.side)
  const activityShown = useActivityPanelStore((s) => s.showPanel)
  const open = useMiniAppStore((s) => s.openApps[instanceKey])
  const appId = open?.entry.id
  const mounted = slot != null && slot.width > 0 && slot.height > 0
  const visible = mounted && activityShown
  // Match the main card corners: fullscreen drops outer radii that sit on the
  // screen edge (right always; left when the sidebar is collapsed).
  const isFullscreen = useFullscreen()
  const showSidebar = useAppStore((s) => s.showSidebar)
  const roundLeft = !isFullscreen || showSidebar
  const roundRight = !isFullscreen

  if (!appId) return null

  return (
    <div
      data-miniapp-host=""
      data-instance-key={instanceKey}
      data-app-id={appId}
      data-miniapp-presentation="panel"
      style={{
        position: 'absolute',
        left: visible ? (slot?.left ?? 0) : -99999,
        top: slot?.top ?? 0,
        width: slot?.width ?? 0,
        height: slot?.height ?? 0,
        display: mounted ? 'block' : 'none',
        pointerEvents: visible && !dragging ? 'auto' : 'none',
        overflow: 'hidden',
        borderBottomLeftRadius: roundLeft && activitySide === 'left' ? 'var(--radius-xl)' : undefined,
        borderBottomRightRadius: roundRight && activitySide === 'right' ? 'var(--radius-xl)' : undefined,
      }}
    >
      <MiniAppView instanceKey={instanceKey} appId={appId} className="h-full w-full" />
    </div>
  )
}
