import { useState, useEffect } from 'react'
import { Sun, Moon, PanelLeft, Code, Paintbrush } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { CommandShortcut } from '@/components/ui/command'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { CodingLayout } from '@/components/coding/CodingLayout'
import { AppSidebar } from '@/components/AppSidebar'
import { StartupPage } from '@/components/StartupPage'
import { SetupPage } from '@/components/SetupPage'
import { SettingsLayout } from '@/components/SettingsLayout'
import { useAgentEvents } from '@/hooks/useAgentEvents'
import { useFullscreen } from '@/hooks/useFullscreen'
import { useAppStore } from '@/stores/app'
import { cn } from '@/lib/utils'

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  return { dark, toggle: () => setDark((d) => !d) }
}

function App(): React.JSX.Element {
  useAgentEvents()
  const theme = useTheme()
  const { view, currentFolder, showSidebar, setShowSidebar, layoutMode, setLayoutMode } = useAppStore()
  const isFullscreen = useFullscreen()

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

  const folderName = currentFolder?.split('/').pop() ?? null

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
      </div>
    )
  }

  // Main view: sidebar + content
  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Sidebar — only in coding mode */}
      {layoutMode === 'coding' && showSidebar && <AppSidebar />}

      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Main header — drag region */}
        <div
          className={`flex h-11 shrink-0 items-center pt-[2px] ${isFullscreen ? 'pl-2' : 'pl-[18px]'}`}
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          {!isFullscreen && !(layoutMode === 'coding' && showSidebar) && <div className="w-[66px] shrink-0" />}
          {layoutMode === 'coding' && !showSidebar && (
            <>
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
            </>
          )}
          {folderName && (
            <span className="truncate text-xs text-muted-foreground">{folderName}</span>
          )}

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
          <CodingLayout />
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
  )
}

export default App
