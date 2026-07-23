import { useRef, useCallback, useEffect } from 'react'
import { Plus } from 'lucide-react'
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
import { ResizeHandleLine } from '@/components/ResizeHandleLine'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuShortcut, DropdownMenuTrigger } from '@superone/ui/components/ui/dropdown-menu'
import { setDockApi } from './activity-panel-api'
import { useActivityLaunchTypes } from './activity-launch-types'
import { activityPanelComponents } from './panels'
import { activityTabComponents } from './ActivityTab'
import { ActivityLauncher } from './ActivityLauncher'
import { cn } from '@superone/ui/lib/utils'

interface ActivityPanelProps {
  getMaxWidth: () => number
  hidden?: boolean
}

function ActivityPrefixActions() {
  const showSidebar = useAppStore((s) => s.showSidebar)
  const side = useActivityPanelStore((s) => s.side)
  const isFullscreen = useFullscreen()
  const isMac = window.app.platform === 'darwin'
  const hostsLayoutToggle = side === 'left' && !(isMac && showSidebar)
  const needsTrafficLightPadding = isMac && !isFullscreen && !showSidebar && side === 'left'

  if (!hostsLayoutToggle) return null
  return (
    <div className={cn('flex h-full items-center', needsTrafficLightPadding ? 'pl-2' : '')}>
      {needsTrafficLightPadding && <div className="h-full w-[66px] shrink-0" />}
      <LayoutToggle />
    </div>
  )
}

function ActivityWatermark() {
  return (
    <div className="relative h-full">
      <div className="absolute inset-x-0 top-0 z-10 h-[34px]">
        <ActivityPrefixActions />
      </div>
      <ActivityLauncher />
    </div>
  )
}

function ActivityNewTabAction() {
  const types = useActivityLaunchTypes()
  return (
    <div className="flex h-full items-center px-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="New tab"
          >
            <Plus className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {types.map(({ id, icon: Icon, label, shortcut, disabled, onOpen }) => (
            <DropdownMenuItem key={id} disabled={disabled} onSelect={() => onOpen()}>
              <Icon className="size-4" />
              {label}
              {shortcut && <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function ActivityPanel({ getMaxWidth, hidden }: ActivityPanelProps) {
  const { showPanel, side, panelWidth, setPanelWidthByUser } = useActivityPanelStore()
  const visible = showPanel && !hidden
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<DockviewApi | null>(null)

  const getWidth = useCallback(() => useActivityPanelStore.getState().panelWidth, [])

  const onResizeStart = useResizeHandle({
    getWidth,
    setWidth: setPanelWidthByUser,
    minWidth: LAYOUT.MIN_AP,
    getMaxWidth,
    direction: side === 'right' ? 'rtl' : 'ltr',
    outerRef,
    innerRef,
  })

  const onReady = useCallback((event: DockviewReadyEvent) => {
    apiRef.current = event.api
    setDockApi(event.api)

    const syncHasPanels = () => useActivityPanelStore.getState().setHasPanels(event.api.panels.length > 0)
    syncHasPanels()

    const dAdd = event.api.onDidAddPanel(syncHasPanels)
    const d1 = event.api.onDidRemovePanel(() => {
      syncHasPanels()
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

    return () => { dAdd.dispose(); d1.dispose(); d2.dispose(); d3.dispose(); d4.dispose() }
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
    <>
      <div
        ref={outerRef}
        data-activity-outer=""
        className={cn('relative shrink-0 overflow-hidden transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]')}
        style={{ width: visible ? panelWidth : 0, order: side === 'left' ? 0 : 2 }}
      >
        <div ref={innerRef} data-activity-inner="" className="flex h-full flex-col overflow-hidden" style={{ width: panelWidth }}>
          <div className="min-h-0 flex-1">
            <DockviewReact
              className="dockview-theme-superone"
              tabAnimation="smooth"
              onReady={onReady}
              components={activityPanelComponents}
              tabComponents={activityTabComponents}
              watermarkComponent={ActivityWatermark}
              prefixHeaderActionsComponent={ActivityPrefixActions}
              leftHeaderActionsComponent={ActivityNewTabAction}
            />
          </div>
        </div>
      </div>

      {visible && (
        <div
          onMouseDown={onResizeStart}
          className="group absolute inset-y-0 z-30 w-2 cursor-col-resize"
          style={side === 'right' ? { right: panelWidth - 4 } : { left: panelWidth - 4 }}
        >
          <ResizeHandleLine orientation="vertical" />
        </div>
      )}
    </>
  )
}
