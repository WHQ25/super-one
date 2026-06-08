import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelLeft, PanelRight, PanelTop, PanelBottom, SquarePlus } from 'lucide-react'
import { useMiniAppStore } from '@/stores/miniapp'
import { useAppStore } from '@/stores/app'
import { useActivityDropStore, type DropPosition } from '@/stores/activity-drop'
import { useActivityPanelStore } from '@/stores/activity-panel'
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

function useGlobalDragging() {
  const [dragging, setDragging] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const clear = () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = null
      setDragging(false)
    }
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) return
      setDragging(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(clear, 150)
    }
    window.addEventListener('dragover', onDragOver, true)
    window.addEventListener('drop', clear, true)
    window.addEventListener('dragend', clear, true)
    return () => {
      window.removeEventListener('dragover', onDragOver, true)
      window.removeEventListener('drop', clear, true)
      window.removeEventListener('dragend', clear, true)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return dragging
}

export function MiniAppHostLayer() {
  const openInstanceKeys = useMiniAppStore(useShallow((s) => Object.keys(s.openApps)))
  const layoutMode = useAppStore((s) => s.layoutMode)
  const dragging = useGlobalDragging()
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
        <PersistentMiniAppContainer key={instanceKey} instanceKey={instanceKey} layoutMode={layoutMode} dragging={dragging} />
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

function PersistentMiniAppContainer({ instanceKey, layoutMode, dragging }: { instanceKey: string; layoutMode: 'canvas' | 'coding'; dragging: boolean }) {
  const slot = useMiniAppStore((s) => s.slots[instanceKey])
  const activitySide = useActivityPanelStore((s) => s.side)
  const open = useMiniAppStore((s) => s.openApps[instanceKey])
  const appId = open?.entry.id
  const presentation = open?.presentation
  const presentationMatches =
    (layoutMode === 'canvas' && presentation === 'canvas') ||
    (layoutMode === 'coding' && presentation === 'panel')
  const visible = presentationMatches && slot != null && slot.width > 0 && slot.height > 0

  if (!appId) return null

  return (
    <div
      data-miniapp-host=""
      data-instance-key={instanceKey}
      data-app-id={appId}
      data-miniapp-presentation={presentation}
      style={{
        position: 'absolute',
        left: slot?.left ?? 0,
        top: slot?.top ?? 0,
        width: slot?.width ?? 0,
        height: slot?.height ?? 0,
        display: visible ? 'block' : 'none',
        pointerEvents: visible && !dragging ? 'auto' : 'none',
        overflow: 'hidden',
        borderBottomLeftRadius: layoutMode === 'coding' && activitySide === 'left' ? 'var(--radius-xl)' : undefined,
        borderBottomRightRadius: layoutMode === 'coding' && activitySide === 'right' ? 'var(--radius-xl)' : undefined,
      }}
    >
      <MiniAppView instanceKey={instanceKey} appId={appId} className="h-full w-full" />
    </div>
  )
}
