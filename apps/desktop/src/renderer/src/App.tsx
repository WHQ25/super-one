import { useEffect, useLayoutEffect, useCallback, useRef, useState, lazy, Suspense } from 'react'
import { flushSync } from 'react-dom'
import { Smartphone, SquareTerminal, LayoutGrid, PanelLeft, PanelRight, PanelLeftDashed, PanelRightDashed } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { LayoutToggle } from '@/components/coding/LayoutToggle'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { CodingWorkspace } from '@/components/coding/CodingWorkspace'
import { ActivityPanel } from '@/components/activity/ActivityPanel'
import { useActivityPanelOnScreen } from '@/hooks/useActivityPanelOnScreen'
import { SideChatConfirmDialog } from '@/components/chat/SideChatConfirmDialog'
import { openBrowserTab, beginMosaicRecording, replayMosaicOpenedPanels } from '@/components/activity/activity-panel-api'
import { useMosaicStore } from '@/components/mosaic/mosaic-store'
import { MosaicDropZone } from '@/components/mosaic/MosaicDropZone'
import { MosaicDropPreview } from '@/components/mosaic/MosaicDropPreview'
import { measureMin } from '@/components/mosaic/mosaic-tree'
import { AppSidebar } from '@/components/AppSidebar'
import { SidebarFrame } from '@/components/sidebar/SidebarFrame'
import { WindowsTitleBar } from '@/components/WindowsTitleBar'
import { StartupPage } from '@/components/StartupPage'
import { SetupPage } from '@/components/SetupPage'
import { OnboardingPage } from '@/components/onboarding/OnboardingPage'
import { HarnessAlignPage } from '@/components/onboarding/HarnessAlignPage'
import { ExternalLinkConfirm } from '@/components/ExternalLinkConfirm'
import { MiniAppClipboardGuard } from '@/components/MiniAppClipboardGuard'
import { MiniAppMediaIndicator } from '@/components/miniapp/MiniAppMediaIndicator'
import { MiniWindowHeader } from '@/components/MiniWindowApp'
import { MiniAppHostLayer } from '@/components/miniapp/MiniAppHostLayer'
import { BrowserHostLayer } from '@/components/browser/BrowserHostLayer'
import { DeviceHostLayer } from '@/components/device/DeviceHostLayer'
import { ComputerUseHostLayer } from '@/components/computer-use/ComputerUseHostLayer'
import { DebugPanel } from '@/components/DebugPanel'
import { useResizeHandle } from '@/hooks/useResizeHandle'
import { useAgentEvents } from '@/hooks/useAgentEvents'
import { useRemoteControl } from '@/hooks/useRemoteControl'
import { useFullscreen } from '@/hooks/useFullscreen'
import { useReactScan } from '@/hooks/useReactScan'
import { useAgentViewfinder } from '@/hooks/useAgentViewfinder'
import { GitAutoRefresh } from '@/hooks/useGitAutoRefresh'
import { useTheme } from '@/hooks/useTheme'
import { useHarnessTheme } from '@/hooks/useHarnessTheme'
import { useMiniAppHostActions } from '@/hooks/useMiniAppHostActions'
import { useMiniAppContextConsumedRelay } from '@/hooks/useContextConsumedEvent'
import { useMobileUploadToasts } from '@/hooks/useMobileUploadToasts'
import { useAppStore, startProjectMirror } from '@/stores/app'
import { FOLD_PANEL_MS, selectMiniDriven, selectPanelsFolded, useWindowMiniModeStore } from '@/stores/window-mini-mode'
import { useDevToolsStore } from '@/stores/dev-tools'
import { useActivityPanelStore } from '@/stores/activity-panel'
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
import { startAnalytics } from '@/lib/analytics'
import { applyCrispText } from '@/lib/font-smoothing'
import { preloadFileHighlighter } from '@/lib/diff-utils'
import { LAYOUT, maxSidebarWidth } from '@/lib/layout-constants'
import { toggleSidebar } from '@/lib/layout-actions'

export { LAYOUT }

const SettingsLayout = lazy(() => import('@/components/SettingsLayout').then((m) => ({ default: m.SettingsLayout })))

function App(): React.JSX.Element {
  useAgentEvents()
  useRemoteControl()
  useHarnessTheme()
  useMobileUploadToasts()
  useMiniAppHostActions()
  useMiniAppContextConsumedRelay()
  // Native Computer Use frames enter the same renderer-owned viewfinder used by the
  // browser and device previews.
  useAgentViewfinder()
  const devReactScan = useDevToolsStore((s) => s.reactScan)
  useReactScan(devReactScan)
  useTheme()
  const { t } = useTranslation()
  const { view, currentFolder, showSidebar, sidebarWidth, setSidebarWidth } = useAppStore(useShallow((s) => ({ view: s.view, currentFolder: s.currentFolder, showSidebar: s.showSidebar, sidebarWidth: s.sidebarWidth, setSidebarWidth: s.setSidebarWidth })))
  const liquidGlass = useAppStore((s) => s.liquidGlass)
  const { open: terminalOpen, toggle: toggleTerminal, setOpen: setTerminalOpen } = useTerminalPanel()
  const hasTerminals = useTerminalStore(
    (s) => (currentFolder ? (s.byProject[currentFolder]?.tabs.length ?? 0) : 0) > 0,
  )
  const showActivityPanel = useActivityPanelStore((s) => s.showPanel)
  const activitySide = useActivityPanelStore((s) => s.side)
  const hasActivityPanels = useActivityPanelStore((s) => s.hasPanels)
  const activityMaximized = useActivityPanelStore((s) => s.maximized)
  // Whether the panel is really on screen — `showPanel` alone misses the mosaic and
  // mini-window-fold hides. See the hook for why the two must never drift apart.
  const activityOnScreen = useActivityPanelOnScreen()
  const mosaicMode = useMosaicStore((s) => s.mode)
  const mosaicRoot = useMosaicStore((s) => s.root)
  const canRestoreMosaic = useMosaicStore((s) => s.lastLayout !== null)
  const draggingSession = useMosaicStore((s) => s.draggingSession)
  const isFullscreen = useFullscreen()
  const isMac = window.app.platform === 'darwin'
  const isWindows = window.app.platform === 'win32'
  // Windowed mode floats the main card a few px off the chrome for a glass
  // inset. Fullscreen drops the inset so the card flushes to the screen edges.
  const cardTopMargin = isFullscreen || isWindows ? 'mt-0' : 'mt-[5px]'
  const initialTransition = useRef(true)

  // Collapse/expand the activity panel while keeping browsers & mini-apps mounted
  // (showPanel just hides the host layers, same as mosaic mode). No-op in mosaic,
  // which force-hides the panel and owns the layout itself.
  const toggleActivityPanel = useCallback(() => {
    if (useMosaicStore.getState().mode === 'mosaic') return
    const ap = useActivityPanelStore.getState()
    if (!ap.showPanel && !ap.userResized) {
      const { showSidebar: sb, sidebarWidth: sw } = useAppStore.getState()
      const maxAp = window.innerWidth - (sb ? sw : 0) - MIN_MAIN - CARD_GUTTER
      if (maxAp >= MIN_AP) ap.setPanelWidth(Math.max(MIN_AP, maxAp))
    }
    ap.setShowPanel(!ap.showPanel)
  }, [])

  useEffect(() => {
    const unsub = window.app.onCodexSkillsChanged?.((event) => {
      void useChatStore.getState().refreshCodexSkills(event.projectPath)
    })
    return () => { unsub?.() }
  }, [])

  // Persist unsent composers when the window is backgrounded or closing —
  // navigate-away promote only covers session switches, not quit-while-focused.
  useEffect(() => {
    let flushing = false
    const flush = () => {
      if (flushing) return
      flushing = true
      void import('@/stores/chat-store/helpers/draft-promote')
        .then(({ promoteAllUnsentDrafts }) => promoteAllUnsentDrafts(useChatStore.getState()))
        .finally(() => { flushing = false })
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
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
        if (s.analyticsEnabled) startAnalytics()
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
    const off = window.app.onUpdateEvent((event) => {
      useAppStore.getState().handleUpdateEvent(event)
    })
    // Subscribe first, then catch up: the startup check usually finishes before
    // this effect runs, and that event is never re-sent.
    void useAppStore.getState().syncUpdateState()
    return off
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
        toggleSidebar()
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
      // ⌘T opens a browser tab when focus is inside the activity panel (its dockview
      // or a browser/mini-app host) — never from the chat panel. Guest browser webviews
      // take the IPC path below (keys don't bubble to the host). The empty launcher has
      // no tab to hold focus yet, so also honor ⌘T whenever it is showing (panel visible
      // with no panels) — it advertises the shortcut regardless of where focus sits.
      const { showPanel, hasPanels } = useActivityPanelStore.getState()
      const inActivity = document.activeElement?.closest('[data-activity-inner],[data-browser-host],[data-miniapp-host]')
      if (!inActivity && !(showPanel && !hasPanels)) return
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

  const mosaicMin = mosaicMode === 'mosaic' && mosaicRoot ? measureMin(mosaicRoot) : null
  const mosaicMinW = mosaicMin?.w ?? 0
  const mosaicMinH = mosaicMin?.h ?? 0
  // The mini-window fold drives the window itself: panels shut, window narrows to one
  // chat column, and back. Layout code that reacts to window size has to sit that out
  // — clamping against those intermediate widths would rewrite the user's panel widths,
  // and re-asserting the 1120px floor would shove the window back open mid-animation.
  const inMiniWindow = useWindowMiniModeStore(selectMiniDriven)
  // Keep the compact shell through the entire unfold, then restore the full shell only
  // after the native window has reached its original bounds.
  const compactMiniShell = useWindowMiniModeStore((s) => s.phase === 'mini' || s.phase === 'unfolding')
  // Both side panels shed as one move, from both edges at once.
  const panelsFolded = useWindowMiniModeStore(selectPanelsFolded)
  useEffect(() => {
    if (inMiniWindow) return
    let minW = view === 'main'
      ? (activityMaximized ? LAYOUT.MIN_AP : LAYOUT.MIN_MAIN + (showActivityPanel ? LAYOUT.MIN_AP : 0))
        + (showSidebar ? LAYOUT.MIN_SIDEBAR : 0)
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
  }, [view, showSidebar, showActivityPanel, activityMaximized, mosaicMinW, mosaicMinH, inMiniWindow])

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

  const getLinkedPanel = useCallback((newW: number, prevW: number) => {
    const ap = useActivityPanelStore.getState()
    if (!ap.showPanel || ap.maximized || ap.side !== 'left') return null
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
    if (useActivityPanelStore.getState().maximized) return
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
    const clampBody = () => {
      if (selectMiniDriven(useWindowMiniModeStore.getState())) return
      const { showSidebar: sb, sidebarWidth: sw, setSidebarWidth: setSW } = useAppStore.getState()
      const ap = useActivityPanelStore.getState()
      const curWidth = window.innerWidth
      const delta = curWidth - prevWidth
      prevWidth = curWidth

      const mainMin = mainMinWRef.current
      if (delta !== 0 && ap.showPanel && !ap.maximized) {
        const maxAp = curWidth - (sb ? sw : 0) - mainMin - CARD_GUTTER
        ap.setPanelWidth(Math.max(MIN_AP, Math.min(ap.panelWidth + delta, maxAp)))
      }

      if (sb) {
        const maxSw = maxSidebarWidth(curWidth, ap.maximized ? MIN_AP : mainMin, ap.showPanel && !ap.maximized ? ap.panelWidth : 0)
        if (sw > maxSw) setSW(Math.max(MIN_SIDEBAR, maxSw))
      }

      const activityWidth = ap.showPanel && !ap.maximized ? ap.panelWidth : 0
      const contentMin = ap.maximized ? MIN_AP : mainMin
      const totalPanels = (sb ? Math.min(sw, MAX_SIDEBAR) : 0) + activityWidth
      let overflow = totalPanels + contentMin + CARD_GUTTER - curWidth
      if (overflow <= 0) return
      if (ap.showPanel && !ap.maximized) {
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
      // The fold resizes the window on purpose, and killing the panels' width
      // transition here is exactly what would make them snap instead of slide.
      if (selectMiniDriven(useWindowMiniModeStore.getState())) return
      const outers = document.querySelectorAll<HTMLElement>('[data-activity-outer],[data-sidebar-outer]')
      outers.forEach((el) => { el.style.transition = 'none' })
      clearTimeout(restoreTimer)
      restoreTimer = window.setTimeout(() => { outers.forEach((el) => { el.style.transition = '' }) }, 160)
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

  const getActivityMaxWidth = useCallback(() => {
    const sb = useAppStore.getState()
    return window.innerWidth - (sb.showSidebar ? sb.sidebarWidth : 0) - MIN_MAIN - CARD_GUTTER
  }, [])

  const sessionId = useActiveSession((s) => s._activeSessionId ?? s.session?.sessionId ?? '')
  const sessionFallback = useActiveSession((s) => s._title ?? extractSessionTitle(s.messages))

  useEffect(() => {
    useActivityPanelStore.getState().resetUserResized()
  }, [sessionId])

  if (view === 'loading') {
    return (
      <>
        <div
          className="flex h-screen flex-col items-center justify-center bg-background text-muted-foreground"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <div className="text-sm">{t('common.loading')}</div>
        </div>
        <MiniAppHostLayer />
        <BrowserHostLayer />
        <ComputerUseHostLayer />
        <DeviceHostLayer />
      </>
    )
  }

  const enterAnimation = initialTransition.current ? { animation: 'fade-in 300ms ease-out' } : undefined
  initialTransition.current = false

  // Non-main views: keep simple titlebar layout.
  // macOS: empty h-11 row clears traffic lights + hosts MiniAppMediaIndicator.
  // Windows: WindowsTitleBar already owns the top chrome — do not stack another
  // empty toolbar or settings/startup/setup sit ~44px too low under the header.
  if (view !== 'main') {
    return (
      <>
        <div className="flex h-screen flex-col bg-background text-foreground" style={enterAnimation}>
          <WindowsTitleBar />
          {isMac && (
            <div className="flex h-11 shrink-0 items-center justify-between px-3" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
              <div className="w-20" />
              <div />
              <div className="flex items-center gap-1.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
                <MiniAppMediaIndicator />
              </div>
            </div>
          )}
          {view === 'onboarding' && <OnboardingPage />}
          {view === 'harness-align' && <HarnessAlignPage />}
          {view === 'startup' && <StartupPage />}
          {view === 'setup' && <SetupPage />}
          {view === 'settings' && (
            <Suspense fallback={<div className="flex-1 bg-background" />}>
              <SettingsLayout />
            </Suspense>
          )}
        </div>
        <MiniAppHostLayer />
        <BrowserHostLayer />
        <ComputerUseHostLayer />
        <DeviceHostLayer />
      </>
    )
  }

  // Main view: sidebar + content
  return (
    <>
    <div className={cn(
      'flex h-screen flex-col overflow-hidden text-foreground',
      compactMiniShell ? (liquidGlass ? 'bg-transparent' : 'bg-card') : 'bg-sidebar',
    )} style={enterAnimation}>
      {!compactMiniShell && <WindowsTitleBar />}
      <div className="group/coding flex min-h-0 flex-1 overflow-hidden">
      <GitAutoRefresh />
      <>
      <div className="relative flex shrink-0">
      <SidebarFrame
        open={showSidebar && !panelsFolded}
        width={sidebarWidth}
        durationMs={inMiniWindow ? FOLD_PANEL_MS : undefined}
        outerRef={sidebarRef}
        innerRef={sidebarInnerRef}
      >
        <AppSidebar />
      </SidebarFrame>
        {showSidebar && !panelsFolded && (
          <div
            data-resize-handle
            onMouseDown={onResizeStart}
            className="group absolute inset-y-0 -right-1 z-30 w-2 cursor-col-resize"
          >
            <div className={`pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-linear-to-b from-transparent via-border to-transparent transition-opacity dark:via-foreground ${sidebarResizing ? 'opacity-100 dark:opacity-40' : 'opacity-0 group-hover:opacity-100 dark:group-hover:opacity-40'}`} />
          </div>
        )}
      </div>

      {/* Main area wrapper — windowed: floating glass card; fullscreen: edge-flush
          (keep left radius only while the sidebar is open to soften that seam). */}
      <div ref={mainWrapperRef} className={cn(
        'relative z-20 flex min-w-0 flex-1 overflow-hidden bg-card',
        compactMiniShell
          ? 'rounded-none border-0 shadow-none'
          : isFullscreen
          ? cn(
              'rounded-r-none border-0 shadow-none',
              showSidebar ? 'rounded-l-xl' : 'rounded-none',
            )
          : cn(
              'rounded-xl border border-border/50',
              cardTopMargin,
              'mb-[5px] mr-[5px]',
              !showSidebar && 'ml-[5px]',
              mosaicMode !== 'mosaic' && 'transition-shadow duration-200',
              mosaicMode !== 'mosaic' && (sidebarResizing
                ? 'border-border shadow-[0_10px_30px_rgba(0,0,0,0.16)]'
                : 'shadow-[0_2px_12px_rgba(0,0,0,0.06)] group-has-[[data-resize-handle]:hover]/coding:border-border group-has-[[data-resize-handle]:hover]/coding:shadow-[0_10px_30px_rgba(0,0,0,0.16)]'),
            ),
      )}>
        <ActivityPanel
          getMaxWidth={getActivityMaxWidth}
          transitionMs={inMiniWindow ? FOLD_PANEL_MS : undefined}
        />

        <SideChatConfirmDialog />

        {/* Main area */}
        <div data-main-area="" className={cn(
          'relative z-10 flex-1 flex-col overflow-hidden',
          activityMaximized && !inMiniWindow ? 'hidden' : 'flex',
          activityOnScreen && (activitySide === 'left' ? 'border-l border-border' : 'border-r border-border'),
        )} style={{ order: 1, minWidth: inMiniWindow ? 0 : MIN_MAIN }}>
        {/* Main header — drag region (hidden in mosaic; each tile carries its own) */}
        {compactMiniShell
          ? <MiniWindowHeader initialTitle={sessionFallback ?? undefined} canRestore transparentBackground={liquidGlass} />
          : mosaicMode !== 'mosaic' && (
        <div
          className={cn('flex h-[34px] shrink-0 items-center transition-[padding-left] duration-300 ease-in-out', !isMac || (isFullscreen && !hasLeftPanel) ? 'pl-2' : 'pl-[18px]')}
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          {isMac && <div className={cn('shrink-0 transition-[width] duration-300 ease-in-out', isFullscreen || hasLeftPanel ? 'w-0' : 'w-[60px]')} />}
          {(!isMac || !showSidebar) && !(showActivityPanel && activitySide === 'left') && <LayoutToggle />}
          <HeaderTitle sessionId={sessionId} sessionFallback={sessionFallback} folderPath={currentFolder} />

          <div className="flex-1" />

          {/* Mini-app controls */}
          <div className="mr-3 flex items-center gap-1.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <MiniAppMediaIndicator />
            {(() => {
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
            {canRestoreMosaic && (
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
          </div>
        </div>
        )}

        {/* Content */}
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          {!liquidGlass && mosaicMode !== 'mosaic' && <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-linear-to-b from-card to-transparent" />}
          <CodingWorkspace mosaicMode={mosaicMode} compact={compactMiniShell} />
        </div>
        {draggingSession && mosaicMode === 'mosaic' && <MosaicDropPreview />}
      </div>
      </div>
      </>
      {activityMaximized && !inMiniWindow && <ChatPanel anchorBoundaryRef={mainWrapperRef} />}
      <ExternalLinkConfirm />
      <MiniAppClipboardGuard />
      {import.meta.env.DEV && <DebugPanel />}
      </div>
    </div>
    <MiniAppHostLayer />
    <BrowserHostLayer />
    <ComputerUseHostLayer />
    <DeviceHostLayer />
    {draggingSession && mosaicMode !== 'mosaic' && (
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

function HeaderTitle({ sessionId, sessionFallback, folderPath }: { sessionId: string; sessionFallback: string | null | undefined; folderPath: string | null }) {
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

export default App
