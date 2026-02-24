import { useEffect, useCallback, useRef } from 'react'
import { Sun, Moon, PanelLeft, Code, Paintbrush } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { CommandShortcut } from '@/components/ui/command'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { CodingLayout } from '@/components/coding/CodingLayout'
import { FilePanel } from '@/components/coding/FilePanel'
import { AppSidebar } from '@/components/AppSidebar'
import { StartupPage } from '@/components/StartupPage'
import { SetupPage } from '@/components/SetupPage'
import { SettingsLayout } from '@/components/SettingsLayout'
import { UpdateNotification } from '@/components/UpdateNotification'
import { useAgentEvents } from '@/hooks/useAgentEvents'
import { useFullscreen } from '@/hooks/useFullscreen'
import { useGitAutoRefresh } from '@/hooks/useGitAutoRefresh'
import { useTheme } from '@/hooks/useTheme'
import { useAppStore } from '@/stores/app'
import { useActiveSession } from '@/stores/chat'
import { cn } from '@/lib/utils'

function App(): React.JSX.Element {
  useAgentEvents()
  useGitAutoRefresh()
  const theme = useTheme()
  const { view, currentFolder, showSidebar, setShowSidebar, sidebarWidth, setSidebarWidth, showFilePanel, filePanelWidth, setFilePanelWidth, layoutMode, setLayoutMode } = useAppStore()
  const isFullscreen = useFullscreen()

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

  // Non-main views: keep simple titlebar layout
  if (view !== 'main') {
    return (
      <div className="flex h-screen flex-col bg-background text-foreground">
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
    <div className="flex h-screen overflow-hidden bg-sidebar text-foreground">
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

      {/* File Panel — between sidebar and main area */}
      {layoutMode === 'coding' && (
        <div
          ref={fpRef}
          className="relative shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out"
          style={{ width: showFilePanel ? filePanelWidth : 0 }}
        >
          <div ref={fpInnerRef} className="h-full" style={{ width: filePanelWidth }}>
            <FilePanel />
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

      {/* Main area — overlaps sidebar with rounded left edge */}
      <div className={cn('flex min-w-[400px] flex-1 flex-col transition-[border-radius] duration-300', layoutMode === 'coding' && hasLeftPanel && 'rounded-l-xl bg-background overflow-hidden')}>
        {/* Main header — drag region */}
        <div
          className={cn('flex h-11 shrink-0 items-center bg-card pt-[2px] transition-[padding-left] duration-300 ease-in-out', isFullscreen && !(layoutMode === 'coding' && hasLeftPanel) ? 'pl-2' : 'pl-[18px]')}
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <div className={cn('shrink-0 transition-[width] duration-300 ease-in-out', !isFullscreen && !(layoutMode === 'coding' && hasLeftPanel) ? 'w-[66px]' : 'w-0')} />
          {layoutMode === 'coding' && (
            <div className={cn('shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out', showSidebar ? 'w-0' : 'w-[30px]')}>
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
          )}
          <span className="max-w-[200px] truncate text-xs text-muted-foreground">
            {layoutMode === 'coding' ? (sessionTitle ?? 'New Session') : folderName}
          </span>

          <div className="flex-1" />

          {/* Mode switch */}
          <div
            className="mr-3 flex items-center rounded-md border border-border bg-muted/50 p-0.5"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <button
              onClick={() => setLayoutMode('canvas')}
              className={cn(
                'rounded px-1.5 py-0.5 transition-colors',
                layoutMode === 'canvas'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Paintbrush className="size-3.5" />
            </button>
            <button
              onClick={() => setLayoutMode('coding')}
              className={cn(
                'rounded px-1.5 py-0.5 transition-colors',
                layoutMode === 'coding'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Code className="size-3.5" />
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
      <UpdateNotification />
    </div>
  )
}

export default App
