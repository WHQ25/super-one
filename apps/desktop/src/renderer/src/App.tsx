import { useEffect, useLayoutEffect, useCallback, useRef, useState, lazy, Suspense } from 'react'
import { flushSync } from 'react-dom'
import { Sun, Moon, X, Smartphone, Minimize2, SquareTerminal, RotateCw, Bug, LayoutGrid, Globe, PanelLeft, PanelRight, PanelLeftDashed, PanelRightDashed } from 'lucide-react'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { LayoutToggle } from '@/components/coding/LayoutToggle'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { CodingLayout } from '@/components/coding/CodingLayout'
import { CanvasPanel } from '@/components/canvas/CanvasPanel'
import { ActivityPanel } from '@/components/activity/ActivityPanel'
import { openBrowserTab, restoreBrowserToPanel, closeFullscreenBrowser, beginMosaicRecording, replayMosaicOpenedPanels } from '@/components/activity/activity-panel-api'
import { SessionMosaic } from '@/components/mosaic/SessionMosaic'
import { useMosaicStore } from '@/components/mosaic/mosaic-store'
import { MosaicDropZone } from '@/components/mosaic/MosaicDropZone'
import { MosaicDropPreview } from '@/components/mosaic/MosaicDropPreview'
import { measureMin } from '@/components/mosaic/mosaic-tree'
import { AppSidebar } from '@/components/AppSidebar'
import { WindowsTitleBar } from '@/components/WindowsTitleBar'
import { StartupPage } from '@/components/StartupPage'
import { SetupPage } from '@/components/SetupPage'
import { UpdateNotification } from '@/components/UpdateNotification'
import { ExternalLinkConfirm } from '@/components/ExternalLinkConfirm'
import { MiniAppClipboardGuard } from '@/components/MiniAppClipboardGuard'
import { MiniAppMediaIndicator } from '@/components/miniapp/MiniAppMediaIndicator'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { MiniAppHostLayer } from '@/components/miniapp/MiniAppHostLayer'
import { BrowserHostLayer } from '@/components/browser/BrowserHostLayer'
import { DebugPanel } from '@/components/DebugPanel'
import { useResizeHandle } from '@/hooks/useResizeHandle'
import { useAgentEvents } from '@/hooks/useAgentEvents'
import { useRemoteControl } from '@/hooks/useRemoteControl'
import { useFullscreen } from '@/hooks/useFullscreen'
import { useReactScan } from '@/hooks/useReactScan'
import { useStandaloneToolCallRouter } from '@/hooks/useStandaloneToolCallRouter'
import { GitAutoRefresh } from '@/hooks/useGitAutoRefresh'
import { useTheme } from '@/hooks/useTheme'
import { useHarnessTheme } from '@/hooks/useHarnessTheme'
import { useMobileUploadToasts } from '@/hooks/useMobileUploadToasts'
import { useAppStore, startProjectMirror } from '@/stores/app'
import { useDevToolsStore } from '@/stores/dev-tools'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useMiniAppStore } from '@/stores/miniapp'
import { useBrowserStore } from '@/stores/browser'
import { useActivityViewStateStore } from '@/stores/activity-view-state'
import { useTerminalPanel } from '@/hooks/useTerminalPanel'
import { useTerminalStore } from '@/stores/terminal'
import { useActiveSession, extractSessionTitle, useChatStore } from '@/stores/chat'
import { SessionTitleAnimated } from '@/components/sidebar/AnimatedSessionTitle'
import { HeaderSessionMenu } from '@/components/chat/HeaderSessionMenu'
import { useSettingsStore } from '@/stores/settings'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '@superone/ui/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@superone/ui/components/ui/tooltip'
import { CommandShortcut } from '@superone/ui/components/ui/command'
import { initAnalytics } from '@/lib/analytics'
import { applyCrispText } from '@/lib/font-smoothing'
import { preloadFileHighlighter } from '@/lib/diff-utils'
import { LAYOUT, maxSidebarWidth } from '@/lib/layout-constants'

export { LAYOUT }

const SettingsLayout = lazy(() => import('@/components/SettingsLayout').then((m) => ({ default: m.SettingsLayout })))

function App(): React.JSX.Element {
  useAgentEvents()
  useRemoteControl()
  useHarnessTheme()
  useMobileUploadToasts()
  useStandaloneToolCallRouter()
  const devReactScan = useDevToolsStore((s) => s.reactScan)
  useReactScan(devReactScan)
  const theme = useTheme()
  const { t } = useTranslation()
  const { view, currentFolder, showSidebar, sidebarWidth, setSidebarWidth, layoutMode } = useAppStore(useShallow((s) => ({ view: s.view, currentFolder: s.currentFolder, showSidebar: s.showSidebar, sidebarWidth: s.sidebarWidth, setSidebarWidth: s.setSidebarWidth, layoutMode: s.layoutMode })))
  const liquidGlass = useAppStore((s) => s.liquidGlass)
  const { open: terminalOpen, toggle: toggleTerminal, setOpen: setTerminalOpen } = useTerminalPanel()
  const hasTerminals = useTerminalStore(
    (s) => (currentFolder ? (s.byProject[currentFolder]?.tabs.length ?? 0) : 0) > 0,
  )
  const showActivityPanel = useActivityPanelStore((s) => s.showPanel)
  const activitySide = useActivityPanelStore((s) => s.side)
  const hasActivityPanels = useActivityPanelStore((s) => s.hasPanels)
  const mosaicMode = useMosaicStore((s) => s.mode)
  const mosaicRoot = useMosaicStore((s) => s.root)
  const canRestoreMosaic = useMosaicStore((s) => s.lastLayout !== null)
  const draggingSession = useMosaicStore((s) => s.draggingSession)
  const fullscreenApp = useMiniAppStore((s) => s.fullscreenApp)
  const fullscreenBrowserId = useBrowserStore((s) => s.fullscreenId)
  const isFullscreen = useFullscreen()
  const isMac = window.app.platform === 'darwin'
  const initialTransition = useRef(true)

  // Collapse/expand the activity panel while keeping browsers & mini-apps mounted
  // (showPanel just hides the host layers, same as mosaic mode). No-op in mosaic,
  // which force-hides the panel and owns the layout itself.
  const toggleActivityPanel = useCallback(() => {
    if (useMosaicStore.getState().mode === 'mosaic') return
    const ap = useActivityPanelStore.getState()
    ap.setShowPanel(!ap.showPanel)
  }, [])

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
    prevSessionIdRef.current = activeSessionId
    // Mosaic force-hides the global panel; parking that hidden state would
    // corrupt each tile's remembered panel/dock. Freeze per-session view state
    // while mosaic owns the layout — entry parks the seed, exit restores the tile.
    if (useMosaicStore.getState().mode === 'mosaic') return
    const view = useActivityViewStateStore.getState()
    if (prev) view.park(prev)
    if (activeSessionId) view.restore(activeSessionId)
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
      if (e.key === 'b' && !e.altKey) {
        e.preventDefault()
        useAppStore.getState().setShowSidebar(!useAppStore.getState().showSidebar)
      } else if (e.key === ',') {
        e.preventDefault()
        const { view, navigateTo } = useAppStore.getState()
        navigateTo(view === 'settings' ? 'main' : 'settings')
      } else if (e.key === 'j' && useMosaicStore.getState().mode === 'mosaic') {
        // CodingLayout (which owns ⌘J in single mode) is unmounted while in
        // mosaic, so handle it here — opening the terminal collapses to single.
        e.preventDefault()
        toggleTerminal()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggleTerminal])

  // New browser tab (⌘T / Ctrl+T). The renderer keydown covers app focus; the
  // IPC path fires when a browser <webview> has focus (guest keys never bubble
  // to the host, so main forwards the shortcut — see browser-popup-redirect.ts).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey
      if (!mod || e.shiftKey || e.altKey || e.key.toLowerCase() !== 't') return
      if (useAppStore.getState().view !== 'main') return
      // ⌘T opens a browser tab only when focus is inside the activity panel (its
      // dockview or a browser/mini-app host) — never from the chat panel. Guest
      // browser webviews take the IPC path below (keys don't bubble to the host).
      if (!document.activeElement?.closest('[data-activity-inner],[data-browser-host],[data-miniapp-host]')) return
      e.preventDefault()
      openBrowserTab()
    }
    window.addEventListener('keydown', handler)
    const offIpc = window.app.onBrowserNewTabShortcut(() => openBrowserTab())
    return () => {
      window.removeEventListener('keydown', handler)
      offIpc()
    }
  }, [isMac])

  // ⌘⌥B (Cmd/Ctrl+Alt+B) collapses/expands the activity panel. Uses e.code since
  // Option remaps e.key to a symbol on macOS.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey
      if (!mod || !e.altKey || e.code !== 'KeyB') return
      if (useAppStore.getState().view !== 'main') return
      e.preventDefault()
      toggleActivityPanel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isMac, toggleActivityPanel])

  // Mosaic is chat-only. On entry we park the seed session's live panel/dock and
  // close the global panel so a hidden panel doesn't skew layout or bounce us back
  // out; on exit each maximized tile restores its own per-session view state.
  const panelSnapshotRef = useRef<{ sessionId: string | null; terminalOpen: boolean } | null>(null)
  const prevMosaicModeRef = useRef(mosaicMode)
  useEffect(() => {
    const was = prevMosaicModeRef.current
    prevMosaicModeRef.current = mosaicMode
    if (was !== 'mosaic' && mosaicMode === 'mosaic') {
      // Capture the entering session's real panel/dock before we hide it, so
      // maximizing back to it restores correctly (mechanism-1 freezes after this).
      if (activeSessionId) useActivityViewStateStore.getState().park(activeSessionId)
      panelSnapshotRef.current = { sessionId: activeSessionId, terminalOpen }
      setTerminalOpen(false)
      useActivityPanelStore.getState().setShowPanel(false)
      beginMosaicRecording()
    } else if (was === 'mosaic' && mosaicMode !== 'mosaic') {
      const snap = panelSnapshotRef.current
      panelSnapshotRef.current = null
      // The maximized tile governs the activity panel: restore its own per-session
      // state. (If the active session is still resolving, mechanism-1 re-applies it
      // once it settles — this only covers exiting onto the already-active tile.)
      if (activeSessionId) useActivityViewStateStore.getState().restore(activeSessionId)
      // Browsers/mini-apps opened while mosaic hid the dock were clobbered by the
      // restore above; replay them so they survive the return to single and show.
      replayMosaicOpenedPanels()
      // Terminal is per-session; re-open the seed session's terminal we force-closed
      // on entry (a no-op in view unless that session is the maximized one).
      if (snap?.sessionId) useTerminalStore.getState().setOpen(snap.sessionId, snap.terminalOpen)
    }
  }, [mosaicMode, showActivityPanel, activeSessionId, terminalOpen, setTerminalOpen])

  const prevActivityShownRef = useRef(showActivityPanel)
  useEffect(() => {
    const activityRose = !prevActivityShownRef.current && showActivityPanel
    prevActivityShownRef.current = showActivityPanel
    if (mosaicMode !== 'mosaic' || !activityRose) return
    useActivityPanelStore.getState().setShowPanel(false)
  }, [mosaicMode, showActivityPanel])

  const mosaicMin = layoutMode === 'coding' && mosaicMode === 'mosaic' && mosaicRoot ? measureMin(mosaicRoot) : null
  const mosaicMinW = mosaicMin?.w ?? 0
  const mosaicMinH = mosaicMin?.h ?? 0
  useEffect(() => {
    const isCoding = view === 'main' && layoutMode === 'coding'
    let minW = isCoding
      ? LAYOUT.MIN_MAIN
        + (showSidebar ? LAYOUT.MIN_SIDEBAR : 0)
        + (showActivityPanel ? LAYOUT.MIN_AP : 0)
        + (showSidebar || showActivityPanel ? LAYOUT.CARD_GUTTER : 0)
      : LAYOUT.MIN_MAIN + LAYOUT.MIN_SIDEBAR + LAYOUT.MIN_AP
    let minH = 700
    // In mosaic mode the open tiles dictate the floor: the window can't shrink
    // below what the current split layout needs (incl. sidebar + card margins).
    if (mosaicMinW > 0) {
      minW = Math.max(minW, mosaicMinW + (showSidebar ? LAYOUT.MIN_SIDEBAR : 0) + 10)
      minH = Math.max(minH, mosaicMinH + 10)
    }
    window.app.setMinWindowSize(minW, minH)
  }, [view, layoutMode, showSidebar, showActivityPanel, mosaicMinW, mosaicMinH])

  const { MIN_MAIN, MIN_SIDEBAR, MAX_SIDEBAR, MIN_AP, CARD_GUTTER } = LAYOUT
  // In mosaic mode the main area can't shrink below what the current split needs,
  // so the sidebar resize/clamp logic must reserve mosaicMinW (not just MIN_MAIN).
  const mainMinW = Math.max(MIN_MAIN, mosaicMinW)
  const mainMinWRef = useRef(mainMinW)
  mainMinWRef.current = mainMinW
  const clampPanelsRef = useRef<() => void>(() => {})
  const sidebarRef = useRef<HTMLDivElement>(null)
  const sidebarInnerRef = useRef<HTMLDivElement>(null)
  const mainWrapperRef = useRef<HTMLDivElement>(null)

  const nudgeDragRegions = useCallback(() => {
    const el = mainWrapperRef.current
    if (!el) return
    el.style.setProperty('-webkit-app-region', 'no-drag')
    requestAnimationFrame(() => el.style.removeProperty('-webkit-app-region'))
  }, [])

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
      const maxAp = window.innerWidth - newW - MIN_MAIN - CARD_GUTTER
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
      return maxSidebarWidth(window.innerWidth, mainMinWRef.current, ap.showPanel ? MIN_AP : 0)
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
    let restoreTimer = 0
    let prevWidth = window.innerWidth
    let prevSidebar = useAppStore.getState().showSidebar
    const clampBody = () => {
      const { showSidebar: sb, sidebarWidth: sw, setSidebarWidth: setSW } = useAppStore.getState()
      const ap = useActivityPanelStore.getState()
      const curWidth = window.innerWidth
      const delta = curWidth - prevWidth
      prevWidth = curWidth

      const sidebarJustHidden = prevSidebar && !sb
      prevSidebar = sb

      const mainMin = mainMinWRef.current
      if (sidebarJustHidden && ap.showPanel) {
        const maxAp = curWidth - mainMin - CARD_GUTTER
        ap.setPanelWidth(Math.min(maxAp, ap.panelWidth + sw))
      } else if (delta !== 0 && ap.showPanel) {
        const maxAp = curWidth - (sb ? sw : 0) - mainMin - CARD_GUTTER
        ap.setPanelWidth(Math.max(MIN_AP, Math.min(ap.panelWidth + delta, maxAp)))
      }

      if (sb) {
        const maxSw = maxSidebarWidth(curWidth, mainMin, ap.showPanel ? ap.panelWidth : 0)
        if (sw > maxSw) setSW(Math.max(MIN_SIDEBAR, maxSw))
      }

      const totalPanels = (sb ? Math.min(sw, MAX_SIDEBAR) : 0) + (ap.showPanel ? ap.panelWidth : 0)
      let overflow = totalPanels + mainMin + CARD_GUTTER - curWidth
      if (overflow <= 0) return
      if (ap.showPanel) {
        const shrink = Math.min(overflow, ap.panelWidth - MIN_AP)
        if (shrink > 0) { ap.setPanelWidth(ap.panelWidth - shrink); overflow -= shrink }
      }
      if (overflow > 0 && sb) {
        const shrink = Math.min(overflow, sw - MIN_SIDEBAR)
        if (shrink > 0) setSW(sw - shrink)
      }
    }
    const clampPanels = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(clampBody)
    }
    const onWindowResize = () => {
      const outer = document.querySelector<HTMLElement>('[data-activity-outer]')
      if (outer) {
        outer.style.transition = 'none'
        clearTimeout(restoreTimer)
        restoreTimer = window.setTimeout(() => { outer.style.transition = '' }, 160)
      }
      flushSync(clampBody)
    }
    clampPanelsRef.current = clampPanels
    window.addEventListener('resize', onWindowResize)
    const unsubAP = useActivityPanelStore.subscribe((state, prev) => {
      if (state.showPanel && !prev.showPanel) {
        const { showSidebar: sb, sidebarWidth: sw } = useAppStore.getState()
        const maxAp = window.innerWidth - (sb ? sw : 0) - MIN_MAIN - CARD_GUTTER
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
      clearTimeout(restoreTimer)
      window.removeEventListener('resize', onWindowResize)
      unsubAP()
      unsubApp()
    }
  }, [])

  // When the mosaic's minimum width grows (a tile/column was added), re-clamp so an
  // already-wide sidebar gives the tiles their floor back instead of clipping them.
  useEffect(() => {
    clampPanelsRef.current()
  }, [mosaicMinW])


  const hasLeftPanel = showSidebar || (showActivityPanel && activitySide === 'left')
  const canvasCard = layoutMode === 'canvas' && (!!fullscreenApp || !!fullscreenBrowserId)

  const getActivityMaxWidth = useCallback(() => {
    const sb = useAppStore.getState()
    return window.innerWidth - (sb.showSidebar ? sb.sidebarWidth : 0) - MIN_MAIN - CARD_GUTTER
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
          <WindowsTitleBar />
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
    <div className="flex h-screen flex-col overflow-hidden bg-sidebar text-foreground" style={enterAnimation}>
      <WindowsTitleBar />
      <div className="group/coding flex min-h-0 flex-1 overflow-hidden">
      <GitAutoRefresh />
      <>
      {/* Sidebar — hidden in canvas mode */}
      <div className={cn('relative flex shrink-0', layoutMode !== 'coding' && 'hidden')}>
      <motion.div
        ref={sidebarRef}
        layout="position"
        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
        className="relative shrink-0 overflow-hidden"
        style={{ width: showSidebar ? sidebarWidth : 0 }}
      >
        <div ref={sidebarInnerRef} className="h-full" style={{ width: sidebarWidth }}>
          <AppSidebar />
        </div>
      </motion.div>
        {showSidebar && (
          <div
            data-resize-handle
            onMouseDown={onResizeStart}
            className="group absolute inset-y-0 -right-1 z-30 w-2 cursor-col-resize"
          >
            <div className={`pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-linear-to-b from-transparent via-border to-transparent transition-opacity dark:via-foreground ${sidebarResizing ? 'opacity-100 dark:opacity-40' : 'opacity-0 group-hover:opacity-100 dark:group-hover:opacity-40'}`} />
          </div>
        )}
      </div>

      {/* Main area wrapper */}
      <div ref={mainWrapperRef} className={cn(
        'flex min-w-0 flex-1',
        layoutMode === 'coding' && mosaicMode === 'mosaic' && 'relative z-20 my-[5px] mr-[5px] overflow-hidden rounded-xl border border-border/50 bg-card',
        layoutMode === 'coding' && mosaicMode === 'mosaic' && !showSidebar && 'ml-[5px]',
        layoutMode === 'coding' && mosaicMode !== 'mosaic' && 'relative z-20 my-[5px] mr-[5px] overflow-hidden rounded-xl border border-border/50 bg-card transition-shadow duration-200',
        layoutMode === 'coding' && mosaicMode !== 'mosaic' && !showSidebar && 'ml-[5px]',
        layoutMode === 'coding' && mosaicMode !== 'mosaic' && (sidebarResizing
          ? 'border-border shadow-[0_10px_30px_rgba(0,0,0,0.16)]'
          : 'shadow-[0_2px_12px_rgba(0,0,0,0.06)] group-has-[[data-resize-handle]:hover]/coding:border-border group-has-[[data-resize-handle]:hover]/coding:shadow-[0_10px_30px_rgba(0,0,0,0.16)]'),
        canvasCard && 'm-[5px] overflow-hidden rounded-xl border border-border/50 bg-card shadow-[0_2px_12px_rgba(0,0,0,0.06)]'
      )}>
        {/* Activity Panel — always mounted, hidden in canvas mode */}
        <ActivityPanel getMaxWidth={getActivityMaxWidth} hidden={layoutMode !== 'coding' || mosaicMode === 'mosaic'} />

        {/* Main area */}
        <motion.div layout="position" onLayoutAnimationComplete={nudgeDragRegions} transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }} className={cn('relative z-10 flex min-w-[400px] flex-1 flex-col', layoutMode === 'coding' && 'overflow-hidden', layoutMode === 'coding' && showActivityPanel && (activitySide === 'left' ? 'border-l border-border' : 'border-r border-border'))} style={{ order: 1 }}>
        {/* Main header — drag region (hidden in mosaic; each tile carries its own) */}
        {mosaicMode !== 'mosaic' && (
        <div
          className={cn('flex h-[34px] shrink-0 items-center transition-[padding-left] duration-300 ease-in-out', !isMac || (isFullscreen && !(layoutMode === 'coding' && hasLeftPanel)) ? 'pl-2' : 'pl-[18px]')}
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          {isMac && <div className={cn('shrink-0 transition-[width] duration-300 ease-in-out', isFullscreen || (layoutMode === 'coding' && hasLeftPanel) ? 'w-0' : layoutMode === 'coding' ? 'w-[60px]' : 'w-[66px]')} />}
          {layoutMode === 'coding' && (!isMac || !showSidebar) && !(showActivityPanel && activitySide === 'left') && <LayoutToggle />}
          <HeaderTitle layoutMode={layoutMode} sessionId={sessionId} sessionFallback={sessionFallback} folderName={folderName} folderPath={currentFolder} />

          <div className="flex-1" />

          {/* Mini-app controls + theme */}
          <div className="mr-3 flex items-center gap-1.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <MiniAppMediaIndicator />
            <CanvasDevControls />
            <CanvasReturnToPanelButton />
            <CanvasCloseButton />
            {layoutMode === 'coding' && (() => {
              const terminalButton = (
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
                    <TooltipContent side="top"><span>{t('tooltips.toggleTerminal')}</span> <CommandShortcut>{isMac ? '⌘J' : 'Ctrl+J'}</CommandShortcut></TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )
              const ActivityIcon = activitySide === 'left'
                ? (showActivityPanel ? PanelRightDashed : PanelRight)
                : (showActivityPanel ? PanelLeftDashed : PanelLeft)
              const activityButton = (
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={toggleActivityPanel}
                        className={cn(
                          'rounded-md p-1.5 transition-colors hover:bg-muted hover:text-foreground',
                          showActivityPanel ? 'text-foreground' : 'text-muted-foreground/60',
                        )}
                      >
                        <ActivityIcon className={cn('size-3.5', !showActivityPanel && hasActivityPanels && 'animate-pulse')} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top"><span>{t('tooltips.toggleActivityPanel')}</span> <CommandShortcut>{isMac ? '⌘⌥B' : 'Ctrl+Alt+B'}</CommandShortcut></TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )
              return activitySide === 'left'
                ? <>{activityButton}{terminalButton}</>
                : <>{terminalButton}{activityButton}</>
            })()}
            {layoutMode === 'coding' && canRestoreMosaic && (
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => useMosaicStore.getState().restoreLayout()}
                      className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <LayoutGrid className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top"><span>{t('tooltips.sessionGrid')}</span></TooltipContent>
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
        )}

        {/* Content */}
        {layoutMode === 'coding' ? (
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            {!liquidGlass && mosaicMode !== 'mosaic' && <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-linear-to-b from-card to-transparent" />}
            {mosaicMode === 'mosaic' ? <SessionMosaic /> : <CodingLayout />}
          </div>
        ) : (
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <CanvasPanel />
          </div>
        )}
        {layoutMode === 'coding' && draggingSession && mosaicMode === 'mosaic' && <MosaicDropPreview />}
      </motion.div>
      </div>
      </>
      {layoutMode === 'canvas' && <ChatPanel />}
      <UpdateNotification />
      <ExternalLinkConfirm />
      <MiniAppClipboardGuard />
      {import.meta.env.DEV && <DebugPanel />}
      </div>
    </div>
    <MiniAppHostLayer />
    <BrowserHostLayer />
    {layoutMode === 'coding' && draggingSession && mosaicMode !== 'mosaic' && (
      <MosaicSingleDropOverlay wrapperRef={mainWrapperRef} canRestoreMosaic={canRestoreMosaic} />
    )}
    </>
  )
}

function MosaicSingleDropOverlay({ wrapperRef, canRestoreMosaic }: { wrapperRef: React.RefObject<HTMLDivElement | null>; canRestoreMosaic: boolean }) {
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  useLayoutEffect(() => {
    const measure = () => {
      const el = wrapperRef.current
      if (el) {
        const r = el.getBoundingClientRect()
        setRect({ left: r.left, top: r.top, width: r.width, height: r.height })
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [wrapperRef])
  if (!rect) return null
  return (
    <div style={{ position: 'fixed', left: rect.left, top: rect.top, width: rect.width, height: rect.height, zIndex: 40 }}>
      {!canRestoreMosaic && (
        <MosaicDropZone tileId={null} onDropSession={(fp, sid, edge) => useMosaicStore.getState().addTile(fp, sid, { edge })} />
      )}
      <MosaicDropPreview />
    </div>
  )
}

function CanvasCloseButton() {
  const layoutMode = useAppStore((s) => s.layoutMode)
  const fullscreenApp = useMiniAppStore((s) => s.fullscreenApp)
  const fullscreenBrowserId = useBrowserStore((s) => s.fullscreenId)
  const closeFullscreenApp = useMiniAppStore((s) => s.closeFullscreenApp)
  const { t } = useTranslation()
  if (layoutMode !== 'canvas') return null
  if (fullscreenBrowserId) {
    return (
      <button
        onClick={() => closeFullscreenBrowser()}
        className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
        title={t('tooltips.closeBrowser')}
      >
        <X className="size-3.5" />
      </button>
    )
  }
  if (!fullscreenApp) return null
  return (
    <button
      onClick={() => closeFullscreenApp()}
      className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
      title={t('tooltips.closeMiniApp')}
    >
      <X className="size-3.5" />
    </button>
  )
}

function CanvasDevControls() {
  const layoutMode = useAppStore((s) => s.layoutMode)
  const fullscreenApp = useMiniAppStore((s) => s.fullscreenApp)
  const devControls = useMiniAppStore((s) => (fullscreenApp ? s.devControls[fullscreenApp.instanceKey] : undefined))
  const { t } = useTranslation()
  if (layoutMode !== 'canvas' || !fullscreenApp || !devControls) return null
  return (
    <>
      <button
        onClick={() => devControls.reload()}
        className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
        title={t('tooltips.reload')}
      >
        <RotateCw className="size-3.5" />
      </button>
      <button
        onClick={() => devControls.openDevTools()}
        className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
        title={t('tooltips.openDevTools')}
      >
        <Bug className="size-3.5" />
      </button>
    </>
  )
}

function CanvasReturnToPanelButton() {
  const layoutMode = useAppStore((s) => s.layoutMode)
  const fullscreenApp = useMiniAppStore((s) => s.fullscreenApp)
  const fullscreenBrowserId = useBrowserStore((s) => s.fullscreenId)
  const moveAppToPanel = useMiniAppStore((s) => s.moveAppToPanel)
  const { t } = useTranslation()
  if (layoutMode !== 'canvas') return null
  if (fullscreenBrowserId) {
    return (
      <button
        onClick={() => restoreBrowserToPanel()}
        className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
        title={t('tooltips.returnToPanel')}
      >
        <Minimize2 className="size-3.5" />
      </button>
    )
  }
  if (!fullscreenApp) return null
  return (
    <button
      onClick={() => moveAppToPanel(fullscreenApp.instanceKey)}
      className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
      title={t('tooltips.returnToPanel')}
    >
      <Minimize2 className="size-3.5" />
    </button>
  )
}

function HeaderTitle({ layoutMode, sessionId, sessionFallback, folderName, folderPath }: { layoutMode: 'canvas' | 'coding'; sessionId: string; sessionFallback: string | null | undefined; folderName: string | null | undefined; folderPath: string | null }) {
  const fullscreenApp = useMiniAppStore((s) => s.fullscreenApp)
  const fullscreenBrowser = useBrowserStore((s) => (s.fullscreenId ? s.tabs[s.fullscreenId] : null))
  if (layoutMode === 'canvas' && fullscreenBrowser) {
    return (
      <span className="flex max-w-[220px] items-center gap-1.5 text-xs text-muted-foreground">
        {fullscreenBrowser.favicon
          ? <img src={fullscreenBrowser.favicon} alt="" className="size-3.5 shrink-0 rounded-sm" />
          : <Globe className="size-3.5 shrink-0" />}
        <span className="truncate">{fullscreenBrowser.title || 'New Tab'}</span>
      </span>
    )
  }
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
      <div
        className="group/htitle flex min-w-0 items-center gap-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <SessionTitleAnimated
          sessionId={sessionId}
          fallback={sessionFallback ?? 'New Session'}
          className="max-w-[300px] text-xs text-muted-foreground"
        />
        {sessionId && folderPath ? <HeaderSessionMenu sessionId={sessionId} folderPath={folderPath} /> : null}
      </div>
    )
  }
  return (
    <span className="max-w-[200px] truncate text-xs text-muted-foreground">{folderName ?? ''}</span>
  )
}

export default App
