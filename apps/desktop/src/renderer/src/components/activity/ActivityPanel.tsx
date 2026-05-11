import { useRef, useCallback, useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { DockviewReact } from 'dockview'
import type { DockviewReadyEvent, DockviewApi } from 'dockview-core'
import 'dockview/dist/styles/dockview.css'
import { useAppStore } from '@/stores/app'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useMiniAppStore } from '@/stores/miniapp'
import { useFullscreen } from '@/hooks/useFullscreen'
import { useResizeHandle } from '@/hooks/useResizeHandle'
import { LAYOUT } from '@/lib/layout-constants'
import { LayoutToggle } from '@/components/coding/LayoutToggle'
import { setDockApi, openNewFileTab } from './activity-panel-api'
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
  const showSidebar = useAppStore((s) => s.showSidebar)
  const isLeftmost = !showSidebar && side === 'left'
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

    const d1 = event.api.onDidRemovePanel((panel) => {
      if (panel.id.startsWith('miniapp-')) {
        const appId = panel.id.slice('miniapp-'.length)
        useMiniAppStore.getState().handlePanelRemoved(appId)
      }
      if (event.api.panels.length === 0) {
        useActivityPanelStore.getState().setShowPanel(false)
      }
    })

    const d2 = event.api.onUnhandledDragOverEvent((e) => {
      const types = e.nativeEvent.dataTransfer?.types
      if (types?.includes('Files')) e.accept()
    })

    const d3 = event.api.onDidDrop(async (e) => {
      const files = e.nativeEvent.dataTransfer?.files
      if (!files || files.length === 0) return
      const filePath = window.app.getPathForFile(files[0])
      if (!filePath) return
      const st = await window.app.pathStat(filePath)
      if (!st || st.isDirectory) return
      const activePanel = e.group?.activePanel
      const isSameFile = activePanel?.id === `file:${filePath}`
      if (isSameFile) return
      const posMap = { top: 'above', bottom: 'below', left: 'left', right: 'right', center: 'within' } as const
      const dir = posMap[e.position as keyof typeof posMap] ?? 'within'
      if (activePanel && dir !== 'within') {
        openNewFileTab(filePath, { direction: dir as 'right' | 'below', referencePanel: activePanel.id })
      } else {
        openNewFileTab(filePath)
      }
    })

    const d4 = event.api.onWillShowOverlay((e) => {
      const data = e.options.getData()
      if (!data) return
      if (e.group && data.groupId === e.group.id && e.group.panels.length <= 1) {
        e.preventDefault()
      }
    })

    const container = innerRef.current?.querySelector<HTMLElement>('.dockview-theme-superone')
    const updateSingleGroupClass = () => {
      container?.classList.toggle('single-group', event.api.groups.length <= 1)
    }
    updateSingleGroupClass()
    const d5 = event.api.onDidAddGroup(updateSingleGroupClass)
    const d6 = event.api.onDidRemoveGroup(updateSingleGroupClass)

    return () => { d1.dispose(); d2.dispose(); d3.dispose(); d4.dispose(); d5.dispose(); d6.dispose() }
  }, [])

  useEffect(() => {
    return () => {
      setDockApi(null)
      apiRef.current = null
    }
  }, [])

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
      e.preventDefault()
      e.stopPropagation()
      apiRef.current?.activePanel?.api.close()
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
        <div className="min-h-0 flex-1" onKeyDown={onKeyDown}>
          <DockviewReact
            className={cn('dockview-theme-superone', isLeftmost && 'activity-leftmost')}
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
