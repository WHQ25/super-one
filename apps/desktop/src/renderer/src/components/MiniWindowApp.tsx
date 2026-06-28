import { useCallback, useEffect, useState } from 'react'
import { Pin, PinOff } from 'lucide-react'
import { useChatStore, useActiveSession, extractSessionTitle } from '@/stores/chat'
import { useAppStore, startProjectMirror } from '@/stores/app'
import { SessionPane } from '@/components/chat/SessionPane'
import { useAgentEvents } from '@/hooks/useAgentEvents'
import { useTheme } from '@/hooks/useTheme'
import { useHarnessTheme } from '@/hooks/useHarnessTheme'
import { ExternalLinkConfirm } from '@/components/ExternalLinkConfirm'
import { SessionTitleAnimated, useSessionTitleByAgent } from '@/components/sidebar/AnimatedSessionTitle'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@superone/ui/components/ui/tooltip'
import { cn } from '@superone/ui/lib/utils'

interface MiniWindowAppProps {
  projectPath: string
  sessionId: string
  initialTitle?: string
}

const DOCK_TITLE_MAX = 24

function truncateForDock(s: string): string {
  return s.length <= DOCK_TITLE_MAX ? s : `${s.slice(0, DOCK_TITLE_MAX - 1)}…`
}

export function MiniWindowApp({ projectPath, sessionId, initialTitle }: MiniWindowAppProps): React.JSX.Element {
  useTheme()
  useHarnessTheme()
  useAgentEvents()

  const focusProject = useChatStore((s) => s.focusProject)
  const switchSession = useChatStore((s) => s.switchSession)
  const sessionFallback = useActiveSession((s) => s._title ?? extractSessionTitle(s.messages))
  const activeSessionId = useActiveSession((s) => s._activeSessionId ?? s.session?.sessionId)
  const liveTitle = useSessionTitleByAgent(activeSessionId, sessionFallback)
  const displayTitle = liveTitle || initialTitle || 'Session'
  const isMac = window.app.platform === 'darwin'
  const isWindows = window.app.platform === 'win32'

  useEffect(() => {
    startProjectMirror(useChatStore)
    useAppStore.setState({ view: 'main' })
    useAppStore.getState().loadRemoteConfig()
    useAppStore.getState().loadBrandHues()

    let cancelled = false
    void (async () => {
      try {
        const startupData = await window.app.getStartupData()
        if (cancelled) return
        if (startupData.cached.claude) {
          useChatStore.getState().setHarnessResources('claude', startupData.cached.claude)
        }
        if (startupData.cached.codex) {
          useChatStore.getState().setHarnessResources('codex', startupData.cached.codex)
        }
        void useChatStore.getState().initializeHarness('claude')
        void useChatStore.getState().initializeHarness('codex')

        await useChatStore.getState().syncLiveSnapshots()
        if (cancelled) return

        await focusProject(projectPath)
        if (cancelled) return
        if (useChatStore.getState().projectSessions[projectPath]?._activeSessionId !== sessionId) {
          await switchSession(sessionId)
        }
      } catch (err) {
        console.warn('[mini-window] init failed', err)
      }
    })()
    return () => { cancelled = true }
  }, [projectPath, sessionId, focusProject, switchSession])

  useEffect(() => {
    document.title = truncateForDock(displayTitle)
  }, [displayTitle])

  const matchesTarget = activeSessionId === sessionId

  const [pinnedOnTop, setPinnedOnTop] = useState(false)
  const togglePinned = useCallback(async () => {
    const next = !pinnedOnTop
    try {
      const applied = await window.app.setWindowAlwaysOnTop(next)
      setPinnedOnTop(applied)
    } catch (err) {
      console.warn('[mini-window] setWindowAlwaysOnTop failed', err)
    }
  }, [pinnedOnTop])

  return (
    <div className="flex h-screen flex-col bg-card text-foreground">
      <div
        className="flex h-9 shrink-0 select-none items-center gap-2 bg-card px-3"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {isMac && <div className="w-[66px] shrink-0" />}
        <SessionTitleAnimated
          sessionId={activeSessionId}
          fallback={displayTitle}
          className="min-w-0 flex-1 text-xs text-muted-foreground"
        />
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={togglePinned}
                aria-pressed={pinnedOnTop}
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                className={cn(
                  'shrink-0 cursor-pointer rounded-md p-1.5 transition-colors',
                  pinnedOnTop
                    ? 'text-primary hover:bg-muted'
                    : 'text-muted-foreground/60 hover:bg-muted hover:text-foreground',
                )}
              >
                {pinnedOnTop ? <Pin className="size-3.5" /> : <PinOff className="size-3.5" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {pinnedOnTop ? 'Unpin from top' : 'Pin to top'}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {isWindows && <div className="w-[138px] shrink-0" />}
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-linear-to-b from-card to-transparent" />
        {matchesTarget ? (
          <SessionPane scope={{ projectPath, sessionId }} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground/70">
            Loading session...
          </div>
        )}
      </div>
      <ExternalLinkConfirm />
    </div>
  )
}
