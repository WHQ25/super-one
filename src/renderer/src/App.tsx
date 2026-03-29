import { useEffect, useCallback, useRef } from 'react'
import { Sun, Moon, PanelLeft, PanelLeftDashed, Code, Paintbrush } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { CommandShortcut } from '@/components/ui/command'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { CodingLayout } from '@/components/coding/CodingLayout'
import { FilePanel } from '@/components/coding/FilePanel'
import { SessionHistory } from '@/components/chat/SessionHistory'
import { AppSidebar } from '@/components/AppSidebar'
import { StartupPage } from '@/components/StartupPage'
import { SetupPage } from '@/components/SetupPage'
import { SettingsLayout } from '@/components/SettingsLayout'
import { UpdateNotification } from '@/components/UpdateNotification'
import { useAgentEvents } from '@/hooks/useAgentEvents'
import { useRemoteControl } from '@/hooks/useRemoteControl'
import { useFullscreen } from '@/hooks/useFullscreen'
import { GitAutoRefresh } from '@/hooks/useGitAutoRefresh'
import { useTheme } from '@/hooks/useTheme'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAppStore } from '@/stores/app'
import { useActiveSession } from '@/stores/chat'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '@/lib/utils'

function App(): React.JSX.Element {
  useAgentEvents()
  useRemoteControl()
  const theme = useTheme()
  const { view, currentFolder, showSidebar, setShowSidebar, sidebarWidth, setSidebarWidth, showFilePanel, setShowFilePanel, filePanelView, filePanelWidth, setFilePanelWidth, layoutMode, setLayoutMode } = useAppStore(useShallow((s) => ({ view: s.view, currentFolder: s.currentFolder, showSidebar: s.showSidebar, setShowSidebar: s.setShowSidebar, sidebarWidth: s.sidebarWidth, setSidebarWidth: s.setSidebarWidth, showFilePanel: s.showFilePanel, setShowFilePanel: s.setShowFilePanel, filePanelView: s.filePanelView, filePanelWidth: s.filePanelWidth, setFilePanelWidth: s.setFilePanelWidth, layoutMode: s.layoutMode, setLayoutMode: s.setLayoutMode })))
  const isFullscreen = useFullscreen()
  const isMac = window.app.platform === 'darwin'
  const initialTransition = useRef(true)

  useEffect(() => {
    useAppStore.getState().loadRemoteConfig()
  }, [])

  useEffect(() => {
    if (view === 'loading') {
      useAppStore.getState().continueToMain().catch(() => {
        useAppStore.setState({ view: 'setup' })
      })
    }
  }, [view])

  useEffect(() => {
    return window.app.onUpdateEvent((event) => {
      useAppStore.getState().handleUpdateEvent(event)
    })
  }, [])

  // ⌘B keyboard shortcut to toggle sidebar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 'b') {
        e.preventDefault()
        useAppStore.getState().setShowSidebar(!useAppStore.getState().showSidebar)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Sidebar resize — manipulate DOM directly for smooth dragging
  const MIN_MAIN = 400
  const MIN_SIDEBAR = 200
  const sidebarRef = useRef<HTMLDivElement>(null)
  const sidebarInnerRef = useRef<HTMLDivElement>(null)

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = useAppStore.getState().sidebarWidth
    const outer = sidebarRef.current
    const inner = sidebarInnerRef.current
    if (!outer || !inner) return

    outer.style.transition = 'none'
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: MouseEvent) => {
      const maxW = window.innerWidth - (fpRef.current?.offsetWidth ?? 0) - MIN_MAIN
      const newW = Math.min(maxW, Math.max(MIN_SIDEBAR, startW + ev.clientX - startX))
      outer.style.width = `${newW}px`
      inner.style.width = `${newW}px`
    }
    const onUp = (ev: MouseEvent) => {
      const maxW = window.innerWidth - (fpRef.current?.offsetWidth ?? 0) - MIN_MAIN
      const finalW = Math.min(maxW, Math.max(MIN_SIDEBAR, startW + ev.clientX - startX))
      outer.style.transition = ''
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setSidebarWidth(finalW)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [setSidebarWidth])

  // File panel resize
  const MIN_FP = 200
  const fpRef = useRef<HTMLDivElement>(null)
  const fpInnerRef = useRef<HTMLDivElement>(null)

  const onFpResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = useAppStore.getState().filePanelWidth
    const outer = fpRef.current
    const inner = fpInnerRef.current
    if (!outer || !inner) return

    outer.style.transition = 'none'
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: MouseEvent) => {
      const maxW = window.innerWidth - (sidebarRef.current?.offsetWidth ?? 0) - MIN_MAIN
      const newW = Math.min(maxW, Math.max(MIN_FP, startW + ev.clientX - startX))
      outer.style.width = `${newW}px`
      inner.style.width = `${newW}px`
    }
    const onUp = (ev: MouseEvent) => {
      const maxW = window.innerWidth - (sidebarRef.current?.offsetWidth ?? 0) - MIN_MAIN
      const finalW = Math.min(maxW, Math.max(MIN_FP, startW + ev.clientX - startX))
      outer.style.transition = ''
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setFilePanelWidth(finalW)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [setFilePanelWidth])

  useEffect(() => {
    let raf = 0
    const clampPanels = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const { showSidebar: sb, sidebarWidth: sw, showFilePanel: fp, filePanelWidth: fw, setSidebarWidth: setSW, setFilePanelWidth: setFW } = useAppStore.getState()
        const totalPanels = (sb ? sw : 0) + (fp ? fw : 0)
        let overflow = totalPanels + MIN_MAIN - window.innerWidth
        if (overflow <= 0) return
        if (sb) {
          const shrink = Math.min(overflow, sw - MIN_SIDEBAR)
          if (shrink > 0) { setSW(sw - shrink); overflow -= shrink }
        }
        if (overflow > 0 && fp) {
          const shrink = Math.min(overflow, fw - MIN_FP)
          if (shrink > 0) setFW(fw - shrink)
        }
      })
    }
    window.addEventListener('resize', clampPanels)
    let prevFp = useAppStore.getState().showFilePanel
    const unsub = useAppStore.subscribe((state) => {
      if (state.showFilePanel !== prevFp) {
        prevFp = state.showFilePanel
        if (state.showFilePanel) clampPanels()
      }
    })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', clampPanels)
      unsub()
    }
  }, [])

  const hasLeftPanel = showSidebar || showFilePanel

  const folderName = currentFolder?.split('/').pop() ?? null
  const sessionTitle = useActiveSession((s) => {
    if (s.messages.length === 0) return null
    const firstUser = s.messages.find((m) => m.role === 'user')
    if (!firstUser) return null
    return firstUser.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join(' ')
      .slice(0, 100) || null
  })

  if (view === 'loading') {
    return <div className="h-screen bg-background" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
  }

  const enterAnimation = initialTransition.current ? { animation: 'fade-in 300ms ease-out' } : undefined
  initialTransition.current = false

  // Non-main views: keep simple titlebar layout
  if (view !== 'main') {
    return (
      <div className="flex h-screen flex-col bg-background text-foreground" style={enterAnimation}>
        <div className="flex h-11 shrink-0 items-center justify-between px-3" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <div className="w-20" />
          <div />
          <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
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
        {view === 'settings' && <SettingsLayout />}
        <UpdateNotification />
      </div>
    )
  }

  // Main view: sidebar + content
  return (
    <div className="flex h-screen overflow-hidden bg-sidebar text-foreground" style={enterAnimation}>
      <GitAutoRefresh />
      {/* Sidebar — only in coding mode, animated width */}
      {layoutMode === 'coding' && (
        <div
          ref={sidebarRef}
          className="relative shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out"
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
              <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-linear-to-b from-transparent via-foreground to-transparent opacity-0 transition-opacity group-hover:opacity-40" />
            </div>
          )}
        </div>
      )}

      {/* FilePanel + Main area wrapper — layered card effect */}
      <div className={cn(
        'flex min-w-0 flex-1',
        layoutMode === 'coding' && showFilePanel && 'rounded-l-2xl bg-background/70 overflow-hidden'
      )}>
        {/* File Panel */}
        {layoutMode === 'coding' && (
          <div
            ref={fpRef}
            className="relative shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out"
            style={{ width: showFilePanel ? filePanelWidth : 0 }}
          >
            <div ref={fpInnerRef} className="h-full" style={{ width: filePanelWidth }}>
              {filePanelView === 'history'
                ? <SessionHistory showBackButton={false} onClose={() => setShowFilePanel(false)} />
                : <FilePanel />
              }
            </div>
            {showFilePanel && (
              <div
                onMouseDown={onFpResizeStart}
                className="group absolute inset-y-0 -right-1 w-2 cursor-col-resize"
              >
                <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-linear-to-b from-transparent via-foreground to-transparent opacity-0 transition-opacity group-hover:opacity-40" />
              </div>
            )}
          </div>
        )}

        {/* Main area — overlaps with rounded left edge */}
        <div className={cn('flex min-w-[400px] flex-1 flex-col transition-[border-radius] duration-300', layoutMode === 'coding' && hasLeftPanel && 'rounded-l-2xl bg-background overflow-hidden')}>
        {/* Main header — drag region */}
        <div
          className={cn('flex h-11 shrink-0 items-center bg-card pt-[2px] transition-[padding-left] duration-300 ease-in-out', !isMac || (isFullscreen && !(layoutMode === 'coding' && hasLeftPanel)) ? 'pl-2' : 'pl-[18px]')}
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          {isMac && <div className={cn('shrink-0 transition-[width] duration-300 ease-in-out', !isFullscreen && !(layoutMode === 'coding' && hasLeftPanel) ? 'w-[66px]' : 'w-0')} />}
          {isMac ? (
            layoutMode === 'coding' && (
              <div className={cn('shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out', showSidebar || showFilePanel ? 'w-0' : 'w-[30px]')}>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => setShowSidebar(true)}
                        className="mr-2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                      >
                        <PanelLeft className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" sideOffset={4}>
                      <span>Toggle Sidebar</span> <CommandShortcut>⌘B</CommandShortcut>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            )
          ) : (
            <div className="mr-1 shrink-0">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setShowSidebar(!showSidebar)}
                      className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                    >
                      {showSidebar ? <PanelLeftDashed className="size-3.5" /> : <PanelLeft className="size-3.5" />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={4}>
                    <span>Toggle Sidebar</span> <CommandShortcut>Ctrl+B</CommandShortcut>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          )}
          <span className="max-w-[200px] truncate text-xs text-muted-foreground">
            {layoutMode === 'coding' ? (sessionTitle ?? 'New Session') : folderName}
          </span>

          <div className="flex-1" />

          {/* Mode switch + theme */}
          <div className="mr-3 flex items-center gap-1.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <Tabs
              value={layoutMode}
              onValueChange={(v) => setLayoutMode(v as 'canvas' | 'coding')}
            >
              <TabsList>
                <TabsTrigger value="canvas" className="px-1.5">
                  <Paintbrush className="size-3.5" />
                </TabsTrigger>
                <TabsTrigger value="coding" className="px-1.5">
                  <Code className="size-3.5" />
                </TabsTrigger>
              </TabsList>
            </Tabs>
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
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-linear-to-b from-card to-transparent" />
            <CodingLayout />
          </div>
        ) : (
          <>
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <h1 className="text-4xl font-bold">SuperOne</h1>
                <p className="mt-2 text-muted-foreground">The one, the only! </p>
              </div>
            </div>
            <ChatPanel />
          </>
        )}
      </div>
      </div>
      <UpdateNotification />
    </div>
  )
}

export default App
