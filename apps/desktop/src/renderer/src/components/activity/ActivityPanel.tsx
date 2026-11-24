import { useRef, useCallback, useEffect, useState } from 'react'
import { useSlot, useSlotVersion } from '@superone/ui-slots/react'
import { PluginSlotErrorBoundary } from '@/lib/ui-slots'
import { Plus } from 'lucide-react'
import { DockviewReact } from 'dockview-react'
import type { DockviewReadyEvent, DockviewApi, DockviewTheme, IDockviewHeaderActionsProps, IWatermarkPanelProps } from 'dockview-core'
import 'dockview/dist/styles/dockview.css'
import { selectPanelFillsWindow, useActivityPanelStore } from '@/stores/activity-panel'
import { useActivityViewStateStore } from '@/stores/activity-view-state'
import { useActivityDropStore } from '@/stores/activity-drop'
import { useMiniAppStore } from '@/stores/miniapp'
import { useActivityPanelOnScreen } from '@/hooks/useActivityPanelOnScreen'
import { useResizeHandle } from '@/hooks/useResizeHandle'
import { useSlotBounds } from '@/hooks/useSlotBounds'
import { setChatFloating } from '@/lib/layout-actions'
import { ACTIVITY_PANEL_TRANSITION, LAYOUT } from '@/lib/layout-constants'
import { ActivityHeaderGroupProvider, ActivityHeaderPrefix } from './ActivityHeaderPrefix'
import { ResizeHandleLine } from '@/components/ResizeHandleLine'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuShortcut, DropdownMenuTrigger } from '@superone/ui/components/ui/dropdown-menu'
import { exitMaximizedDock, isLayoutSwapping, isModPanePanel, isPersonClosingModPane, launchInGroup, restorePanelWidthAfterSideChat, setDockApi, SIDE_CHAT_PANEL_ID, toggleMaximizedActivityGroup, type ModPaneTabParams } from './activity-panel-api'
import { bumpActivityDockRevision } from './activity-dock-revision'
import { connectMcpAppTabs } from './mcp-app-tabs'
import { attachChromeTabDrag } from './chrome-tab-drag'
import { watchStickyActiveTabs } from './sticky-active-tab'
import { useActivityLaunchTypes } from './activity-launch-types'
import { activityPanelComponents } from './panels'
import { activityTabComponents } from './ActivityTab'
import { ActivityLauncher } from './ActivityLauncher'
import { cn } from '@superone/ui/lib/utils'

/**
 * dockview 8 moved tab behaviour out of individual props and into a theme
 * object. `className` still points at the stylesheet in dockview-theme.css;
 * everything the theme leaves unset keeps the stylesheet's own default, which
 * is what the custom CSS already drives.
 */
const SUPERONE_DOCKVIEW_THEME: DockviewTheme = {
  name: 'superone',
  className: 'dockview-theme-superone',
  tabAnimation: 'smooth',
}

interface ActivityPanelProps {
  getMaxWidth: () => number
  /** The width limit reserves space for the docked chat. */
  floatChatOnResizeOverflow?: boolean
  /** Overrides the idle transition — the mini-window fold runs the panels on its own clock. */
  transitionMs?: number
  className?: string
}

function ActivityPrefixActions({ group, panels }: IDockviewHeaderActionsProps) {
  // Empty macOS groups host these controls in their watermark instead.
  if (window.app.platform === 'darwin' && panels.length === 0) return null
  return <ActivityHeaderPrefix group={group} />
}

function ActivityWatermark({ group }: IWatermarkPanelProps) {
  return (
    <div className="relative h-full">
      <div className="absolute inset-x-0 top-0 z-10 h-[34px]">
        <ActivityHeaderPrefix group={group} />
      </div>
      <ActivityLauncher group={group} />
    </div>
  )
}

function ActivityNewTabAction({ group }: IDockviewHeaderActionsProps) {
  const types = useActivityLaunchTypes()
  return (
    <div className="flex h-full items-center px-1.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="New tab"
          >
            <Plus className="size-[18px]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {types.map(({ id, icon: Icon, label, shortcut, disabled, onOpen }) => (
            <DropdownMenuItem key={id} disabled={disabled} onSelect={() => launchInGroup(group, onOpen)}>
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

export function ActivityPanel({ getMaxWidth, floatChatOnResizeOverflow, transitionMs, className }: ActivityPanelProps) {
  const { side, panelWidth, setPanelWidthByUser, maximized, setFloatDropPreview } = useActivityPanelStore()
  const fillsWindow = useActivityPanelStore(selectPanelFillsWindow)
  const visible = useActivityPanelOnScreen()
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<DockviewApi | null>(null)
  const [headerApi, setHeaderApi] = useState<DockviewApi | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)

  const getWidth = useCallback(() => useActivityPanelStore.getState().panelWidth, [])
  const collapseChat = useCallback(() => {
    const panel = useActivityPanelStore.getState()
    if (panel.showPanel && !selectPanelFillsWindow(panel)) {
      setChatFloating(true, { expanded: false })
    }
  }, [])
  const layoutDockview = useCallback((width?: number, height?: number) => {
    const inner = innerRef.current
    if (inner) apiRef.current?.layout(width ?? inner.clientWidth, height ?? inner.clientHeight)
  }, [])
  const observeDockview = useCallback((api: DockviewApi) => {
    const inner = innerRef.current
    if (!inner) return
    resizeObserverRef.current?.disconnect()
    api.layout(inner.clientWidth, inner.clientHeight)
    const observer = new ResizeObserver(([entry]) => {
      api.layout(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(inner)
    resizeObserverRef.current = observer
  }, [])

  // The webview host layers are composited outside this element, so they cannot
  // inherit its rounded corners — they read these bounds to work out which of them
  // is the one sitting on a corner. Measured the same way the slots themselves are,
  // so both sides of that comparison move on the same frame.
  useSlotBounds(
    innerRef,
    'activity-panel-bounds',
    (rect) => useActivityPanelStore.getState().setBounds({
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }),
    () => useActivityPanelStore.getState().setBounds(null),
  )

  const getOverflowThreshold = useCallback(() => {
    const mainArea = document.querySelector<HTMLElement>('[data-main-area]')
    const chatWidth = mainArea && mainArea.clientWidth > 0 ? mainArea.clientWidth : LAYOUT.MIN_MAIN
    return chatWidth / 3
  }, [])

  const onResizeStart = useResizeHandle({
    getWidth,
    setWidth: setPanelWidthByUser,
    minWidth: LAYOUT.MIN_AP,
    getMaxWidth,
    direction: side === 'right' ? 'rtl' : 'ltr',
    outerRef,
    innerRef,
    onResize: layoutDockview,
    getOverflowThreshold: floatChatOnResizeOverflow ? getOverflowThreshold : undefined,
    onOverflowChange: floatChatOnResizeOverflow ? setFloatDropPreview : undefined,
    onMaxWidthExceeded: floatChatOnResizeOverflow ? collapseChat : undefined,
  })

  const onReady = useCallback((event: DockviewReadyEvent) => {
    apiRef.current = event.api
    setHeaderApi(event.api)
    observeDockview(event.api)
    setDockApi(event.api)
    connectMcpAppTabs(event.api, toggleMaximizedActivityGroup)

    const syncHasPanels = () => useActivityPanelStore.getState().setHasPanels(event.api.panels.length > 0)
    syncHasPanels()

    const dAdd = event.api.onDidAddPanel(() => {
      syncHasPanels()
      bumpActivityDockRevision()
    })
    const d1 = event.api.onDidRemovePanel((panel) => {
      syncHasPanels()
      bumpActivityDockRevision()
      // A side chat lives exactly as long as its tab. Ignored mid-swap: parking a
      // session's layout removes every panel, and that is a stash, not a close.
      if (panel.id === SIDE_CHAT_PANEL_ID && !isLayoutSwapping()) {
        const { sessionId } = (panel.params ?? {}) as { sessionId?: string }
        // Opening the side chat pinned the panel to its minimum width; a real
        // close is what hands that width back.
        restorePanelWidthAfterSideChat()
        void import('@/lib/side-chat-actions').then((m) => m.handleSideChatTabRemoved(sessionId))
      }
      // A mod pane lives as long as the plugin keeps it: the person's close asks
      // the CLI, and a `ui.close` hook that keeps it open puts the tab back.
      if (isPersonClosingModPane(panel.id)) {
        void import('@/lib/mod-ui/pane-actions').then((m) => m.handleModPaneTabClosed(panel.params as ModPaneTabParams, panel.title ?? ''))
      }
      if (event.api.panels.length === 0) {
        useActivityPanelStore.getState().setShowPanel(false)
      }
    })

    // The person picking a mod's tab shows that pane; the roster sync's own
    // `setActive` is an `api` change and never echoes back.
    const dActive = event.api.onDidActivePanelChange(({ panel, origin }) => {
      if (origin !== 'user' || !panel || !isModPanePanel(panel.id) || isLayoutSwapping()) return
      void import('@/lib/mod-ui/pane-actions').then((m) => m.handleModPaneTabActivated(panel.params as ModPaneTabParams))
    })

    const d2 = event.api.onWillShowOverlay((e) => {
      if (useActivityPanelStore.getState().maximized) {
        useActivityDropStore.getState().setIndicator(null)
        e.preventDefault()
        return
      }
      const data = e.options.getData()
      if (!data) return

      const setIndicator = useActivityDropStore.getState().setIndicator

      if (e.group && data.groupId === e.group.id && e.group.panels.length <= 1) {
        setIndicator(null)
        e.preventDefault()
        return
      }

      if (e.kind === 'content' && (e.position === 'top' || e.position === 'bottom') && e.group) {
        const contentEl = e.group.element.querySelector('.dv-content-container') ?? e.group.element
        const r = contentEl.getBoundingClientRect()
        const clientY = 'clientY' in e.nativeEvent ? e.nativeEvent.clientY : 0
        const TABBAR_EDGE_GUARD_PX = 24
        if (
          clientY > 0
          && r.height > 0
          && ((e.position === 'top' && clientY - r.top < TABBAR_EDGE_GUARD_PX)
            || (e.position === 'bottom' && r.bottom - clientY < TABBAR_EDGE_GUARD_PX))
        ) {
          setIndicator(null)
          e.preventDefault()
          return
        }
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

    const rootEl = innerRef.current
    const container = rootEl?.querySelector<HTMLElement>('.dockview-theme-superone')
    const updateSingleGroupClass = () => {
      container?.classList.toggle('single-group', event.api.groups.length <= 1)
    }
    updateSingleGroupClass()
    const d3 = event.api.onDidAddGroup(updateSingleGroupClass)
    const d4 = event.api.onDidRemoveGroup(updateSingleGroupClass)
    const d5 = event.api.onDidMaximizedGroupChange(({ group, isMaximized }) => {
      useActivityPanelStore.getState().setMaximizedGroup(isMaximized ? group.id : null)
    })

    return () => {
      dAdd.dispose(); d1.dispose(); dActive.dispose(); d2.dispose(); d3.dispose(); d4.dispose(); d5.dispose()
    }
  }, [observeDockview])

  useEffect(() => {
    const root = innerRef.current
    if (!headerApi || !root) return
    const stickyTabs = watchStickyActiveTabs(root)
    const detachChromeDrag = attachChromeTabDrag(root, headerApi)
    stickyTabs.scan()
    const scan = () => stickyTabs.scan()
    const disposables = [
      headerApi.onDidAddPanel(scan),
      headerApi.onDidRemovePanel(scan),
      headerApi.onDidAddGroup(scan),
      headerApi.onDidRemoveGroup(scan),
      headerApi.onDidActivePanelChange(scan),
    ]
    return () => {
      for (const d of disposables) d.dispose()
      detachChromeDrag()
      stickyTabs.stop()
    }
  }, [headerApi])

  useEffect(() => {
    const api = apiRef.current
    if (!visible && api?.hasMaximizedGroup()) exitMaximizedDock()
  }, [visible])

  useEffect(() => {
    const vs = useActivityViewStateStore.getState()
    const sid = vs._currentSessionId
    if (sid) vs.restore(sid)
    return () => {
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null
      const cur = useActivityViewStateStore.getState()._currentSessionId
      if (cur) useActivityViewStateStore.getState().park(cur)
      connectMcpAppTabs(null)
      setDockApi(null)
      apiRef.current = null
    }
  }, [])

  const ActivityOverride = useSlot('shell.activity.content')
  const activitySlotVersion = useSlotVersion('shell.activity.content')
  const dockContent = (
    <ActivityHeaderGroupProvider api={headerApi}>
      <DockviewReact
        theme={SUPERONE_DOCKVIEW_THEME}
        disableAutoResizing
        disableDnd
        // Shift-dragging a tab out into a floating group is off: not every tab kind
        // (webview hosts, terminals, devices) follows a group outside the grid.
        disableFloatingGroups
        scrollbars="native"
        disableTabsOverflowList
        onReady={onReady}
        components={activityPanelComponents}
        tabComponents={activityTabComponents}
        watermarkComponent={ActivityWatermark}
        prefixHeaderActionsComponent={ActivityPrefixActions}
        leftHeaderActionsComponent={ActivityNewTabAction}
      />
    </ActivityHeaderGroupProvider>
  )

  return (
    <>
      <div
        ref={outerRef}
        data-activity-outer=""
        className={cn('relative shrink-0 overflow-hidden transition-[width]', className)}
        style={{
          width: visible ? (fillsWindow ? '100%' : panelWidth) : 0,
          order: side === 'left' ? 0 : 2,
          transitionDuration: `${transitionMs ?? ACTIVITY_PANEL_TRANSITION.durationMs}ms`,
          transitionTimingFunction: ACTIVITY_PANEL_TRANSITION.easing,
        }}
      >
        {/* tabIndex makes this a focus sink — see activity-focus.ts for why the
            panel must never be left without an owner for its own shortcuts. */}
        <div ref={innerRef} data-activity-inner="" tabIndex={-1} className="flex h-full flex-col overflow-hidden outline-none focus-visible:shadow-none" style={{ width: fillsWindow ? '100%' : panelWidth }}>
          <div className="relative min-h-0 flex-1">
            <div className={cn('h-full w-full', ActivityOverride && 'hidden')}>
              {dockContent}
            </div>
            {ActivityOverride && (
              <PluginSlotErrorBoundary resetKey={String(activitySlotVersion)} fallback={dockContent}>
                <ActivityOverride visible={visible} />
              </PluginSlotErrorBoundary>
            )}
          </div>
        </div>
      </div>

      {visible && !fillsWindow && (
        <div
          data-activity-resize-handle=""
          onMouseDown={(event) => { if (event.button === 0) onResizeStart(event) }}
          className="group absolute inset-y-0 z-30 w-2 cursor-col-resize"
          style={side === 'right' ? { right: panelWidth - 4 } : { left: panelWidth - 4 }}
        >
          <ResizeHandleLine orientation="vertical" />
        </div>
      )}
    </>
  )
}
