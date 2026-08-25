import { useCallback, useEffect, useRef, useState } from 'react'
import { Maximize, Pin, PinOff } from 'lucide-react'
import { useActiveSession, extractSessionTitle } from '@/stores/chat'
import { SessionPane } from '@/components/chat/SessionPane'
import { useStandaloneSessionBoot } from '@/hooks/useStandaloneSessionBoot'
import { exitMiniWindow } from '@/stores/window-mini-mode'
import { useWindowChromeSync } from '@/hooks/useWindowChromeSync'
import { ExternalLinkConfirm } from '@/components/ExternalLinkConfirm'
import { SessionTitleAnimated, useSessionTitleByAgent } from '@/components/sidebar/AnimatedSessionTitle'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@superone/ui/components/ui/tooltip'
import { cn } from '@superone/ui/lib/utils'

interface MiniWindowAppProps {
  projectPath: string
  sessionId: string
  initialTitle?: string
  /** True only when this window was converted from the full app, so it can grow back. */
  canRestore?: boolean
}

interface MiniWindowHeaderProps {
  initialTitle?: string
  canRestore?: boolean
  /** Let a parent glass surface paint once instead of stacking another card layer. */
  transparentBackground?: boolean
}

const DOCK_TITLE_MAX = 24

function truncateForDock(s: string): string {
  return s.length <= DOCK_TITLE_MAX ? s : `${s.slice(0, DOCK_TITLE_MAX - 1)}…`
}

/** Shared by spawned mini windows and full windows converted in place. */
export function MiniWindowHeader({ initialTitle, canRestore, transparentBackground = false }: MiniWindowHeaderProps): React.JSX.Element {
  // `initialTitle` is the persisted session title as of window open, so it outranks the
  // first-user-message derivation — that one is only for a session the DB has yet to title.
  const sessionFallback = useActiveSession((s) => s._title ?? initialTitle ?? extractSessionTitle(s.messages))
  const activeSessionId = useActiveSession((s) => s._activeSessionId ?? s.session?.sessionId)
  const liveTitle = useSessionTitleByAgent(activeSessionId, sessionFallback)
  const displayTitle = liveTitle || initialTitle || 'Session'
  const isMac = window.app.platform === 'darwin'
  const isWindows = window.app.platform === 'win32'

  // A converted window swaps back to the full app in place, so the window title has
  // to be handed back — nothing else in the app writes document.title.
  useEffect(() => {
    const previous = document.title
    return () => { document.title = previous }
  }, [])

  useEffect(() => {
    document.title = truncateForDock(displayTitle)
  }, [displayTitle])

  const [pinnedOnTop, setPinnedOnTop] = useState(false)
  // Windows draws its caption buttons over the right end of this strip. Converted
  // glass windows let the parent card paint it; standalone windows paint their own.
  const titleBarRef = useRef<HTMLDivElement>(null)
  useWindowChromeSync(titleBarRef)

  const restoreFullWindow = useCallback(() => {
    exitMiniWindow()
  }, [])

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
    <div
      ref={titleBarRef}
      className={cn(
        'flex h-9 shrink-0 select-none items-center gap-2 px-3',
        transparentBackground ? 'bg-transparent' : 'bg-card',
      )}
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {isMac && <div className="w-[66px] shrink-0" />}
      <SessionTitleAnimated
        sessionId={activeSessionId}
        fallback={displayTitle}
        className="min-w-0 flex-1 text-xs text-muted-foreground"
      />
      {canRestore && (
        <IconButton
          size="xs"
          variant="ghost"
          aria-label="Back to full window"
          tooltip="Back to full window"
          tooltipSide="bottom"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="shrink-0"
          onClick={restoreFullWindow}
        >
          <Maximize />
        </IconButton>
      )}
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
  )
}

export function MiniWindowApp({ projectPath, sessionId, initialTitle, canRestore }: MiniWindowAppProps): React.JSX.Element {
  useStandaloneSessionBoot(projectPath, sessionId)
  const activeSessionId = useActiveSession((s) => s._activeSessionId ?? s.session?.sessionId)
  const matchesTarget = activeSessionId === sessionId

  return (
    <div className="flex h-screen flex-col bg-card text-foreground">
      <MiniWindowHeader initialTitle={initialTitle} canRestore={canRestore} />
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
      <ExternalLinkConfirm enableInApp={false} />
    </div>
  )
}
