import { useRef, useCallback, useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { DockviewReact } from 'dockview'
import type { DockviewReadyEvent, DockviewApi } from 'dockview-core'
import 'dockview/dist/styles/dockview.css'
import { useAppStore } from '@/stores/app'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useActivityViewStateStore } from '@/stores/activity-view-state'
import { useActivityDropStore } from '@/stores/activity-drop'
import { useMiniAppStore } from '@/stores/miniapp'
import { useFullscreen } from '@/hooks/useFullscreen'
import { useResizeHandle } from '@/hooks/useResizeHandle'
import { LAYOUT } from '@/lib/layout-constants'
import { LayoutToggle } from '@/components/coding/LayoutToggle'
import { setDockApi } from './activity-panel-api'
import { activityPanelComponents } from './panels'
import { activityTabComponents } from './ActivityTab'
import { ActivityWatermark } from './ActivityWatermark'
import { cn } from '@superone/ui/lib/utils'

interface ActivityPanelProps {
  getMaxWidth: () => number
  hidden?: boolean
}

function ActivityPrefixActions() {
  const showSidebar = useAppStore((s) => s.showSidebar)
  const side = useActivityPanelStore((s) => s.side)
  const isFullscreen = useFullscreen()
  const isLeftmost = !showSidebar && side === 'left'
  const isMac = window.app.platform === 'darwin'
  const needsTrafficLightPadding = isMac && !isFullscreen && isLeftmost

  if (!isLeftmost) return null
  return (
    <div className={cn('flex h-full items-center', needsTrafficLightPadding ? 'pl-2' : '')}>
      {needsTrafficLightPadding && <div className="h-full w-[66px] shrink-0" />}
      <LayoutToggle />
    </div>
  )
}

export function ActivityPanel({ getMaxWidth, hidden }: ActivityPanelProps) {
  const { showPanel, side, panelWidth, setPanelWidth } = useActivityPanelStore()
  const visible = showPanel && !hidden
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<DockviewApi | null>(null)

  const getWidth = useCallback(() => useActivityPanelStore.getState().panelWidth, [])

  const [isResizing, setIsResizing] = useState(false)
  const baseResizeStart = useResizeHandle({
    getWidth,
    setWidth: setPanelWidth,
    minWidth: LAYOUT.MIN_AP,
    getMaxWidth,
    direction: side === 'right' ? 'rtl' : 'ltr',
    outerRef,
    innerRef,
    onDragEnd: () => setIsResizing(false),
  })
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    setIsResizing(true)
    baseResizeStart(e)
  }, [baseResizeStart])

  const onReady = useCallback((event: DockviewReadyEvent) => {
    apiRef.current = event.api
    setDockApi(event.api)

    const d1 = event.api.onDidRemovePanel(() => {
      if (event.api.panels.length === 0) {
        useActivityPanelStore.getState().setShowPanel(false)
      }
    })

    const d2 = event.api.onWillShowOverlay((e) => {
      const data = e.options.getData()
      if (!data) return

      const setIndicator = useActivityDropStore.getState().setIndicator

      if (e.group && data.groupId === e.group.id && e.group.panels.length <= 1) {
        setIndicator(null)
        e.preventDefault()
        return
      }

      const activeId = e.group?.activePanel?.id
      const instanceKey = activeId?.startsWith('miniapp-') ? activeId.slice('miniapp-'.length) : null
      const slot = instanceKey ? useMiniAppStore.getState().slots[instanceKey] : null

      let area: { left: number; top: number; width: number; height: number } | null = null
      if (slot && slot.width > 0 && slot.height > 0) {
        area = { left: slot.left, top: slot.top, width: slot.width, height: slot.height }
      } else if (e.group) {
        const content = e.group.element.querySelector('.dv-content-container') ?? e.group.element
        const r = content.getBoundingClientRect()
        if (r.width > 0 && r.height > 0) area = { left: r.left, top: r.top, width: r.width, height: r.height }
      }

      if (!area) {
        setIndicator(null)
        return
      }

      const half = e.kind === 'content' ? e.position : 'center'
      const halfW = area.width / 2
      const halfH = area.height / 2
      const box =
        half === 'left' ? { left: area.left, top: area.top, width: halfW, height: area.height }
        : half === 'right' ? { left: area.left + halfW, top: area.top, width: halfW, height: area.height }
        : half === 'top' ? { left: area.left, top: area.top, width: area.width, height: halfH }
        : half === 'bottom' ? { left: area.left, top: area.top + halfH, width: area.width, height: halfH }
        : { left: area.left, top: area.top, width: area.width, height: area.height }
      setIndicator({ ...box, position: half })
    })

    const container = innerRef.current?.querySelector<HTMLElement>('.dockview-theme-superone')
    const updateSingleGroupClass = () => {
      container?.classList.toggle('single-group', event.api.groups.length <= 1)
    }
    updateSingleGroupClass()
    const d3 = event.api.onDidAddGroup(updateSingleGroupClass)
    const d4 = event.api.onDidRemoveGroup(updateSingleGroupClass)

    return () => { d1.dispose(); d2.dispose(); d3.dispose(); d4.dispose() }
  }, [])

  useEffect(() => {
    const vs = useActivityViewStateStore.getState()
    const sid = vs._currentSessionId
    if (sid) vs.restore(sid)
    return () => {
      const cur = useActivityViewStateStore.getState()._currentSessionId
      if (cur) useActivityViewStateStore.getState().park(cur)
      setDockApi(null)
      apiRef.current = null
    }
  }, [])

  return (
    <motion.div
      ref={outerRef}
      data-activity-outer=""
      layout="position"
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      className={cn('relative shrink-0 overflow-hidden', side === 'right' ? 'bg-card' : 'bg-sidebar')}
      style={{ width: visible ? panelWidth : 0, order: side === 'left' ? 0 : 2 }}
    >
      <div ref={innerRef} data-activity-inner="" className="flex h-full flex-col rounded-l-2xl bg-background overflow-hidden" style={{ width: panelWidth }}>
        <div className="min-h-0 flex-1">
          <DockviewReact
            className="dockview-theme-superone"
            tabAnimation="smooth"
            onReady={onReady}
            components={activityPanelComponents}
            tabComponents={activityTabComponents}
            watermarkComponent={ActivityWatermark}
            prefixHeaderActionsComponent={ActivityPrefixActions}
          />
        </div>
      </div>

      {visible && (
        <div
          onMouseDown={onResizeStart}
          className={cn(
            'group absolute inset-y-0 z-40 w-2 cursor-col-resize',
            side === 'right' ? '-left-1' : '-right-1',
          )}
        >
          <div
            className={cn(
              'pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-linear-to-b from-transparent via-foreground to-transparent transition-opacity',
              isResizing ? 'opacity-40' : 'opacity-0 group-hover:opacity-40',
            )}
          />
        </div>
      )}
    </motion.div>
  )
}
