import { useState, useEffect } from 'react'
import { Sun, Moon } from 'lucide-react'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { StartupPage } from '@/components/StartupPage'
import { SetupPage } from '@/components/SetupPage'
import { useAgentEvents } from '@/hooks/useAgentEvents'
import { useAppStore } from '@/stores/app'

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
  const { view, currentFolder } = useAppStore()

  const folderName = currentFolder?.split('/').pop() ?? null

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Title bar — draggable, respects macOS traffic lights */}
      <div className="flex h-11 shrink-0 items-center justify-between px-3" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        {/* Left spacer for traffic lights */}
        <div className="w-20" />

        {/* Center: folder name */}
        {folderName && (
          <span className="truncate text-xs text-muted-foreground">{folderName}</span>
        )}

        {/* Right: theme toggle */}
        <button
          onClick={theme.toggle}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {theme.dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      </div>

      {view === 'startup' && <StartupPage />}
      {view === 'setup' && <SetupPage />}
      {view === 'main' && (
        <>
          {/* Main content */}
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <h1 className="text-4xl font-bold">SuperPM</h1>
              <p className="mt-2 text-muted-foreground">AI-Powered Product Design</p>
            </div>
          </div>
          <ChatPanel />
        </>
      )}
    </div>
  )
}

export default App
