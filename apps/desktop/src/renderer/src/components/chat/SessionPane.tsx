import { useMemo, useRef, type RefObject } from 'react'
import { SessionScopeProvider, type SessionScope } from '@/stores/chat'
import { ChatContent } from '@/components/chat/ChatContent'
import { useChatScroll } from '@/hooks/useChatScroll'
import { usePaneHarnessTheme } from '@/hooks/useHarnessTheme'
import { cn } from '@superone/ui/lib/utils'

interface SessionPaneProps {
  scope?: SessionScope
  className?: string
  foreground?: boolean
}

function SessionPaneBody({ className, rootRef, foreground }: { className?: string; rootRef?: RefObject<HTMLDivElement | null>; foreground: boolean }) {
  const scrollViewportRef = useRef<HTMLDivElement>(null)
  const { showScrollButton, scrollToBottom, stopAutoScroll } = useChatScroll({ scrollViewportRef })
  return (
    <div ref={rootRef} className={cn('@container flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden', className)}>
      <ChatContent scrollViewportRef={scrollViewportRef} showScrollButton={showScrollButton} scrollToBottom={scrollToBottom} stopAutoScroll={stopAutoScroll} foreground={foreground} />
    </div>
  )
}

function ScopedSessionPaneBody({ className, foreground }: { className?: string; foreground: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null)
  usePaneHarnessTheme(rootRef)
  return <SessionPaneBody className={className} rootRef={rootRef} foreground={foreground} />
}

export function SessionPane({ scope, className, foreground = true }: SessionPaneProps) {
  const value = useMemo(
    () => (scope ? { projectPath: scope.projectPath, sessionId: scope.sessionId } : null),
    [scope?.projectPath, scope?.sessionId],
  )
  if (!value) return <SessionPaneBody className={className} foreground={foreground} />
  return (
    <SessionScopeProvider value={value}>
      <ScopedSessionPaneBody className={className} foreground={foreground} />
    </SessionScopeProvider>
  )
}
