import { useEffect, useCallback, useRef, useState, lazy, Suspense } from 'react'
import { Sun, Moon, X, Smartphone, Minimize2, SquareTerminal, RotateCw, Bug } from 'lucide-react'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { LayoutToggle } from '@/components/coding/LayoutToggle'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { CodingLayout } from '@/components/coding/CodingLayout'
import { CanvasPanel } from '@/components/canvas/CanvasPanel'
import { ActivityPanel } from '@/components/activity/ActivityPanel'
import { AppSidebar } from '@/components/AppSidebar'
import { StartupPage } from '@/components/StartupPage'
import { SetupPage } from '@/components/SetupPage'
import { UpdateNotification } from '@/components/UpdateNotification'
import { ExternalLinkConfirm } from '@/components/ExternalLinkConfirm'
import { MiniAppClipboardGuard } from '@/components/MiniAppClipboardGuard'
import { MiniAppMediaIndicator } from '@/components/miniapp/MiniAppMediaIndicator'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { MiniAppHostLayer } from '@/components/miniapp/MiniAppHostLayer'
import { DebugPanel } from '@/components/DebugPanel'
import { useResizeHandle } from '@/hooks/useResizeHandle'
import { useAgentEvents } from '@/hooks/useAgentEvents'
import { useRemoteControl } from '@/hooks/useRemoteControl'
import { useFullscreen } from '@/hooks/useFullscreen'
import { usePerfSampler } from '@/hooks/usePerfSampler'
import { useReactScan } from '@/hooks/useReactScan'
import { useStandaloneToolCallRouter } from '@/hooks/useStandaloneToolCallRouter'
import { GitAutoRefresh } from '@/hooks/useGitAutoRefresh'
import { useTheme } from '@/hooks/useTheme'
import { useHarnessTheme } from '@/hooks/useHarnessTheme'
import { useAppStore, startProjectMirror } from '@/stores/app'
import { useDevToolsStore } from '@/stores/dev-tools'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useMiniAppStore } from '@/stores/miniapp'
import { useActivityViewStateStore } from '@/stores/activity-view-state'
import { useTerminalPanel } from '@/hooks/useTerminalPanel'
import { useTerminalStore } from '@/stores/terminal'
import { useActiveSession, extractSessionTitle, useChatStore } from '@/stores/chat'
import { SessionTitleAnimated } from '@/components/sidebar/AnimatedSessionTitle'
import { useSettingsStore } from '@/stores/settings'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '@superone/ui/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@superone/ui/components/ui/tooltip'
import { CommandShortcut } from '@superone/ui/components/ui/command'
import { initAnalytics } from '@/lib/analytics'
import { applyCrispText } from '@/lib/font-smoothing'
import { preloadFileHighlighter } from '@/lib/diff-utils'
import { LAYOUT } from '@/lib/layout-constants'

export { LAYOUT }

const SettingsLayout = lazy(() => import('@/components/SettingsLayout').then((m) => ({ default: m.SettingsLayout })))

function App(): React.JSX.Element {
  useAgentEvents()
  useRemoteControl()
  usePerfSampler()
  useHarnessTheme()
  useStandaloneToolCallRouter()
  const devReactScan = useDevToolsStore((s) => s.reactScan)
  useReactScan(devReactScan)
  const theme = useTheme()
  const { t } = useTranslation()
  const { view, currentFolder, showSidebar, sidebarWidth, setSidebarWidth, layoutMode } = useAppStore(useShallow((s) => ({ view: s.view, currentFolder: s.currentFolder, showSidebar: s.showSidebar, sidebarWidth: s.sidebarWidth, setSidebarWidth: s.setSidebarWidth, layoutMode: s.layoutMode })))
  const { open: terminalOpen, toggle: toggleTerminal } = useTerminalPanel()
  const hasTerminals = useTerminalStore(
    (s) => (currentFolder ? (s.byProject[currentFolder]?.tabs.length ?? 0) : 0) > 0,
  )
  const showActivityPanel = useActivityPanelStore((s) => s.showPanel)
  const activitySide = useActivityPanelStore((s) => s.side)
  const isFullscreen = useFullscreen()
  const isMac = window.app.platform === 'darwin'
  const initialTransition = useRef(true)

  useEffect(() => {
    const unsub = window.app.onCodexSkillsChanged?.((event) => {
      void useChatStore.getState().refreshCodexSkills(event.projectPath)
    })
    return () => { unsub?.() }
  }, [])

  useEffect(() => {
    startProjectMirror(useChatStore)
    useAppStore.getState().loadRemoteConfig()
    useAppStore.getState().loadBrandHues()
    useSettingsStore.getState().loadDisabledSkills().catch((err) =>
      console.error('[skills] failed to load disabledSkills', err)
    )
    window.app.getAppSettings()
      .then((s) => {
        applyCrispText(s.crispText)
        if (s.analyticsEnabled) initAnalytics()
      })
      .catch((err) => console.error('[analytics] failed to load app settings', err))
    requestIdleCallback(() => preloadFileHighlighter())
  }, [])

  useEffect(() => {
    if (view === 'loading') {
      useAppStore.getState().continueToMain().catch(() => {
        useAppStore.setState({ view: 'setup' })
      })
    }
  }, [view])

  const activeSessionId = useChatStore((s) => {
    const proj = s.activeProject
    return proj ? s.projectSessions[proj]?._activeSessionId ?? null : null
  })
  const prevSessionIdRef = useRef<string | null>(null)
  useEffect(() => {
    const prev = prevSessionIdRef.current
    if (prev === activeSessionId) return
    const view = useActivityViewStateStore.getState()
    if (prev) view.park(prev)
    if (activeSessionId) view.restore(activeSessionId)
    prevSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  useEffect(() => {
    return window.app.onUpdateEvent((event) => {
      useAppStore.getState().handleUpdateEvent(event)
    })
  }, [])

  useEffect(() => {
    return window.app.onDeviceStatusChanged(({ online, firstConnect, name }) => {
      if (!online || !firstConnect) return
      toast.success(t('sidebar.remote.deviceConnectedToast', { name: name ?? '' }), {
        position: 'top-center',
        icon: <Smartphone className="size-4" />,
      })
    })
  }, [t])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.metaKey) return
      if (e.key === 'b') {
        e.preventDefault()
        useAppStore.getState().setShowSidebar(!useAppStore.getState().showSidebar)
      } else if (e.key === ',') {
        e.preventDefault()
        const { view, navigateTo } = useAppStore.getState()
        navigateTo(view === 'settings' ? 'main' : 'settings')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    const isCoding = view === 'main' && layoutMode === 'coding'
    const min = isCoding
      ? LAYOUT.MIN_MAIN
        + (showSidebar ? LAYOUT.MIN_SIDEBAR : 0)
        + (showActivityPanel ? LAYOUT.MIN_AP : 0)
      : LAYOUT.MIN_MAIN + LAYOUT.MIN_SIDEBAR + LAYOUT.MIN_AP
    window.app.setMinWindowSize(min, 700)
  }, [view, layoutMode, showSidebar, showActivityPanel])

  const { MIN_MAIN, MIN_SIDEBAR, MAX_SIDEBAR, MIN_AP } = LAYOUT
  const sidebarRef = useRef<HTMLDivElement>(null)
  const sidebarInnerRef = useRef<HTMLDivElement>(null)

  const getLinkedPanel = useCallback((newW: number, prevW: number) => {
    const ap = useActivityPanelStore.getState()
    if (!ap.showPanel || ap.side !== 'left') return null
    const outer = document.querySelector<HTMLElement>('[data-activity-outer]')
    const inner = document.querySelector<HTMLElement>('[data-activity-inner]')
    if (!outer || !inner) return null
    const delta = newW - prevW
    if (delta === 0) return null
    const currentApW = parseFloat(outer.style.width) || ap.panelWidth
    let newApW: number
    if (delta > 0) {
      newApW = Math.max(MIN_AP, currentApW - delta)
    } else {
      const maxAp = window.innerWidth - newW - MIN_MAIN
      newApW = Math.min(maxAp, currentApW - delta)
    }
    return { width: newApW, outer, inner }
  }, [])

  const [sidebarResizing, setSidebarResizing] = useState(false)

  const onSidebarDragEnd = useCallback(() => {
    setSidebarResizing(false)
    const outer = document.querySelector<HTMLElement>('[data-activity-outer]')
    if (!outer) return
    const w = parseFloat(outer.style.width)
    if (w && w !== useActivityPanelStore.getState().panelWidth) {
      outer.style.transition = ''
      useActivityPanelStore.getState().setPanelWidth(w)
    }
  }, [])

  const baseSidebarResizeStart = useResizeHandle({
    getWidth: () => useAppStore.getState().sidebarWidth,
    setWidth: setSidebarWidth,
    minWidth: MIN_SIDEBAR,
    getMaxWidth: () => {
      const ap = useActivityPanelStore.getState()
      const layoutMax = ap.showPanel
        ? window.innerWidth - MIN_AP - MIN_MAIN
        : window.innerWidth - MIN_MAIN
      return Math.min(MAX_SIDEBAR, layoutMax)
    },
    direction: 'ltr',
    outerRef: sidebarRef,
    innerRef: sidebarInnerRef,
    getLinkedPanel,
    onDragEnd: onSidebarDragEnd,
  })

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    setSidebarResizing(true)
    baseSidebarResizeStart(e)
  }, [baseSidebarResizeStart])

  useEffect(() => {
    let raf = 0
    let prevWidth = window.innerWidth
    let prevSidebar = useAppStore.getState().showSidebar
    const clampPanels = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const { showSidebar: sb, sidebarWidth: sw, setSidebarWidth: setSW } = useAppStore.getState()
        const ap = useActivityPanelStore.getState()
        const curWidth = window.innerWidth
        const delta = curWidth - prevWidth
        prevWidth = curWidth

        const sidebarJustHidden = prevSidebar && !sb
        prevSidebar = sb

        if (sidebarJustHidden && ap.showPanel) {
          const maxAp = curWidth - MIN_MAIN
          ap.setPanelWidth(Math.min(maxAp, ap.panelWidth + sw))
        } else if (delta !== 0 && ap.showPanel) {
          const maxAp = curWidth - (sb ? sw : 0) - MIN_MAIN
          ap.setPanelWidth(Math.max(MIN_AP, Math.min(ap.panelWidth + delta, maxAp)))
        }

        if (sb) {
          const maxSw = Math.min(MAX_SIDEBAR, curWidth - (ap.showPanel ? ap.panelWidth : 0) - MIN_MAIN)
          if (sw > maxSw) setSW(Math.max(MIN_SIDEBAR, maxSw))
        }

        const totalPanels = (sb ? Math.min(sw, MAX_SIDEBAR) : 0) + (ap.showPanel ? ap.panelWidth : 0)
        let overflow = totalPanels + MIN_MAIN - curWidth
        if (overflow <= 0) return
        if (ap.showPanel) {
          const shrink = Math.min(overflow, ap.panelWidth - MIN_AP)
          if (shrink > 0) { ap.setPanelWidth(ap.panelWidth - shrink); overflow -= shrink }
        }
        if (overflow > 0 && sb) {
          const shrink = Math.min(overflow, sw - MIN_SIDEBAR)
          if (shrink > 0) setSW(sw - shrink)
        }
      })
    }
    window.addEventListener('resize', clampPanels)
    const unsubAP = useActivityPanelStore.subscribe((state, prev) => {
      if (state.showPanel && !prev.showPanel) {
        const { showSidebar: sb, sidebarWidth: sw } = useAppStore.getState()
        const maxAp = window.innerWidth - (sb ? sw : 0) - MIN_MAIN
        const clamped = Math.max(MIN_AP, Math.min(state.panelWidth, maxAp))
        if (clamped !== state.panelWidth) {
          useActivityPanelStore.getState().setPanelWidth(clamped)
          return
        }
      }
      if (state.showPanel !== prev.showPanel || state.panelWidth !== prev.panelWidth || state.side !== prev.side) clampPanels()
    })
    const unsubApp = useAppStore.subscribe((state, prev) => {
      if (state.showSidebar !== prev.showSidebar) clampPanels()
    })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', clampPanels)
      unsubAP()
      unsubApp()
    }
  }, [])


  const hasLeftPanel = showSidebar || (showActivityPanel && activitySide === 'left')

  const getActivityMaxWidth = useCallback(() => {
    const sb = useAppStore.getState()
    return window.innerWidth - (sb.showSidebar ? sb.sidebarWidth : 0) - MIN_MAIN
  }, [])

  const folderName = currentFolder?.split('/').pop() ?? null
  const sessionId = useActiveSession((s) => s._activeSessionId ?? s.session?.sessionId ?? '')
  const sessionFallback = useActiveSession((s) => s._title ?? extractSessionTitle(s.messages))

  if (view === 'loading') {
    return (
      <>
        <div className="h-screen bg-background" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
        <MiniAppHostLayer />
      </>
    )
  }

  const enterAnimation = initialTransition.current ? { animation: 'fade-in 300ms ease-out' } : undefined
  initialTransition.current = false

  // Non-main views: keep simple titlebar layout
  if (view !== 'main') {
    return (
      <>
        <div className="flex h-screen flex-col bg-background text-foreground" style={enterAnimation}>
          <div className="flex h-11 shrink-0 items-center justify-between px-3" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
            <div className="w-20" />
            <div />
            <div className="flex items-center gap-1.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
              <MiniAppMediaIndicator />
              <button
                onClick={theme.toggle}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {theme.dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
              </button>
            </div>
          </div>
          {view === 'startup' && <StartupPage />}
          {view === 'setup' && <SetupPage />}
          {view === 'settings' && (
            <Suspense fallback={<div className="flex-1 bg-background" />}>
              <SettingsLayout />
            </Suspense>
          )}
          <UpdateNotification />
        </div>
        <MiniAppHostLayer />
      </>
    )
  }

  // Main view: sidebar + content
  return (
    <>
    <div className="flex h-screen overflow-hidden bg-sidebar text-foreground" style={enterAnimation}>
      <GitAutoRefresh />
      <>
      {/* Sidebar — hidden in canvas mode */}
      <motion.div
        ref={sidebarRef}
        layout="position"
        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
        className={cn('relative shrink-0 overflow-hidden', layoutMode !== 'coding' && 'hidden')}
        style={{ width: showSidebar ? sidebarWidth : 0 }}
      >
        <div ref={sidebarInnerRef} className="h-full" style={{ width: sidebarWidth }}>
          <AppSidebar />
        </div>
        {showSidebar && (
          <div
            onMouseDown={onResizeStart}
            className="group absolute inset-y-0 -right-1 w-2 cursor-col-resize"
          >
            <div className={`pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-linear-to-b from-transparent via-foreground to-transparent transition-opacity ${sidebarResizing ? 'opacity-40' : 'opacity-0 group-hover:opacity-40'}`} />
          </div>
        )}
      </motion.div>

      {/* Main area wrapper */}
      <div className={cn(
        'flex min-w-0 flex-1',
        layoutMode === 'coding' && 'overflow-hidden',
        layoutMode === 'coding' && hasLeftPanel && 'rounded-l-2xl bg-background/70'
      )}>
        {/* Activity Panel — always mounted, hidden in canvas mode */}
        <ActivityPanel getMaxWidth={getActivityMaxWidth} hidden={layoutMode !== 'coding'} />

        {/* Main area */}
        <motion.div layout="position" transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }} className={cn('z-10 flex min-w-[400px] flex-1 flex-col', layoutMode === 'coding' && 'overflow-hidden', layoutMode === 'coding' && hasLeftPanel && 'rounded-l-2xl bg-background')} style={{ order: 1 }}>
        {/* Main header — drag region */}
        <div
          className={cn('flex h-11 shrink-0 items-center bg-card pt-[2px] transition-[padding-left] duration-300 ease-in-out', !isMac || (isFullscreen && !(layoutMode === 'coding' && hasLeftPanel)) ? 'pl-2' : 'pl-[18px]')}
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          {isMac && <div className={cn('shrink-0 transition-[width] duration-300 ease-in-out', !isFullscreen && !(layoutMode === 'coding' && hasLeftPanel) ? 'w-[66px]' : 'w-0')} />}
          {layoutMode === 'coding' && (!isMac || !showSidebar) && !(showActivityPanel && activitySide === 'left') && <LayoutToggle />}
          <HeaderTitle layoutMode={layoutMode} sessionId={sessionId} sessionFallback={sessionFallback} folderName={folderName} />

          <div className="flex-1" />

          {/* Mini-app controls + theme */}
          <div className="mr-3 flex items-center gap-1.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <MiniAppMediaIndicator />
            <CanvasDevControls />
            <CanvasReturnToPanelButton />
            <CanvasCloseButton />
            {layoutMode === 'coding' && (
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={toggleTerminal}
                      className={cn(
                        'rounded-md p-1.5 transition-colors hover:bg-muted hover:text-foreground',
                        terminalOpen ? 'text-foreground' : 'text-muted-foreground/60',
                      )}
                    >
                      <SquareTerminal
                        className={cn('size-3.5', !terminalOpen && hasTerminals && 'animate-pulse')}
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top"><span>Toggle terminal</span> <CommandShortcut>{isMac ? '⌘J' : 'Ctrl+J'}</CommandShortcut></TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <button
              onClick={theme.toggle}
              className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
            >
              {theme.dark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
            </button>
          </div>
        </div>

        {/* Content */}
        {layoutMode === 'coding' ? (
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-linear-to-b from-card to-transparent" />
            <CodingLayout />
          </div>
        ) : (
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <CanvasPanel />
          </div>
        )}
      </motion.div>
      </div>
      </>
      {layoutMode === 'canvas' && <ChatPanel />}
      <UpdateNotification />
      <ExternalLinkConfirm />
      <MiniAppClipboardGuard />
      {import.meta.env.DEV && <DebugPanel />}
    </div>
    <MiniAppHostLayer />
    </>
  )
}

function CanvasCloseButton() {
  const layoutMode = useAppStore((s) => s.layoutMode)
  const fullscreenApp = useMiniAppStore((s) => s.fullscreenApp)
  const closeFullscreenApp = useMiniAppStore((s) => s.closeFullscreenApp)
  if (layoutMode !== 'canvas' || !fullscreenApp) return null
  return (
    <button
      onClick={() => closeFullscreenApp()}
      className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
      title="Close mini-app"
    >
      <X className="size-3.5" />
    </button>
  )
}

function CanvasDevControls() {
  const layoutMode = useAppStore((s) => s.layoutMode)
  const fullscreenApp = useMiniAppStore((s) => s.fullscreenApp)
  const devControls = useMiniAppStore((s) => (fullscreenApp ? s.devControls[fullscreenApp.instanceKey] : undefined))
  if (layoutMode !== 'canvas' || !fullscreenApp || !devControls) return null
  return (
    <>
      <button
        onClick={() => devControls.reload()}
        className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
        title="Reload"
      >
        <RotateCw className="size-3.5" />
      </button>
      <button
        onClick={() => devControls.openDevTools()}
        className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
        title="Open devtools"
      >
        <Bug className="size-3.5" />
      </button>
    </>
  )
}

function CanvasReturnToPanelButton() {
  const layoutMode = useAppStore((s) => s.layoutMode)
  const fullscreenApp = useMiniAppStore((s) => s.fullscreenApp)
  const moveAppToPanel = useMiniAppStore((s) => s.moveAppToPanel)
  if (layoutMode !== 'canvas' || !fullscreenApp) return null
  return (
    <button
      onClick={() => moveAppToPanel(fullscreenApp.instanceKey)}
      className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
      title="Return to panel"
    >
      <Minimize2 className="size-3.5" />
    </button>
  )
}

function HeaderTitle({ layoutMode, sessionId, sessionFallback, folderName }: { layoutMode: 'canvas' | 'coding'; sessionId: string; sessionFallback: string | null | undefined; folderName: string | null | undefined }) {
  const fullscreenApp = useMiniAppStore((s) => s.fullscreenApp)
  if (layoutMode === 'canvas' && fullscreenApp) {
    return (
      <span className="flex max-w-[220px] items-center gap-1.5 text-xs text-muted-foreground">
        <MiniAppIcon appId={fullscreenApp.entry.id} className="size-3.5 shrink-0" />
        <span className="truncate">{fullscreenApp.entry.manifest.name}</span>
      </span>
    )
  }
  if (layoutMode === 'coding') {
    return (
      <SessionTitleAnimated
        sessionId={sessionId}
        fallback={sessionFallback ?? 'New Session'}
        className="max-w-[300px] text-xs text-muted-foreground"
      />
    )
  }
  return (
    <span className="max-w-[200px] truncate text-xs text-muted-foreground">{folderName ?? ''}</span>
  )
}

export default App
