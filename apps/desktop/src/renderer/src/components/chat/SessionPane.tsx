import { useMemo, useRef, type RefObject } from 'react'
import { SessionScopeProvider, markPaneTouched, type SessionScope } from '@/stores/chat'
import { ChatContent } from '@/components/chat/ChatContent'
import { useChatScroll } from '@/hooks/useChatScroll'
import { usePaneHarnessTheme } from '@/hooks/useHarnessTheme'
import { cn } from '@superone/ui/lib/utils'

interface SessionPaneProps {
  scope?: SessionScope
  className?: string
  foreground?: boolean
}

function SessionPaneBody({ className, rootRef, foreground, scope }: { className?: string; rootRef?: RefObject<HTMLDivElement | null>; foreground: boolean; scope?: SessionScope }) {
  const scrollViewportRef = useRef<HTMLDivElement>(null)
  const { showScrollButton, scrollToBottom, stopAutoScroll } = useChatScroll({ scrollViewportRef })
  return (
    // The scope is mirrored onto the DOM so handlers that cannot sit inside the
    // React context — the window-level keyboard shortcuts — can still tell which
    // pane the user is in by walking up from the event target.
    <div
      ref={rootRef}
      data-scope-project={scope?.projectPath}
      data-scope-session={scope?.sessionId}
      // Capture phase, and both events: the pointer-down or focus that lands on a
      // popover trigger happens inside this subtree, before the popover portals
      // its content out of it. That is what leaves the tracker correct for a
      // shortcut fired while focus sits in the portal.
      onPointerDownCapture={() => markPaneTouched(scope ?? null)}
      onFocusCapture={() => markPaneTouched(scope ?? null)}
      className={cn('@container flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden', className)}
    >
      <ChatContent scrollViewportRef={scrollViewportRef} showScrollButton={showScrollButton} scrollToBottom={scrollToBottom} stopAutoScroll={stopAutoScroll} foreground={foreground} />
    </div>
  )
}

function ScopedSessionPaneBody({ className, foreground, scope }: { className?: string; foreground: boolean; scope: SessionScope }) {
  const rootRef = useRef<HTMLDivElement>(null)
  usePaneHarnessTheme(rootRef)
  return <SessionPaneBody className={className} rootRef={rootRef} foreground={foreground} scope={scope} />
}

export function SessionPane({ scope, className, foreground = true }: SessionPaneProps) {
  const value = useMemo(
    () => (scope ? { projectPath: scope.projectPath, sessionId: scope.sessionId } : null),
    [scope?.projectPath, scope?.sessionId],
  )
  if (!value) return <SessionPaneBody className={className} foreground={foreground} />
  return (
    <SessionScopeProvider value={value}>
      <ScopedSessionPaneBody className={className} foreground={foreground} scope={value} />
    </SessionScopeProvider>
  )
}
