import { useState, useEffect } from 'react'
import { Sun, Moon } from 'lucide-react'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { useAgentEvents } from '@/hooks/useAgentEvents'

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

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Title bar — draggable, respects macOS traffic lights */}
      <div className="flex h-11 shrink-0 items-center justify-end px-3" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <button
          onClick={theme.toggle}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {theme.dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      </div>

      {/* Main content */}
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-bold">SuperPM</h1>
          <p className="mt-2 text-muted-foreground">AI-Powered Product Design</p>
        </div>
      </div>
      <ChatPanel />
    </div>
  )
}

export default App
