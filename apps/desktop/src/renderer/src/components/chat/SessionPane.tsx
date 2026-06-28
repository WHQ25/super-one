import { useMemo, useRef } from 'react'
import { SessionScopeProvider, type SessionScope } from '@/stores/chat'
import { ChatContent } from '@/components/chat/ChatContent'
import { useChatScroll } from '@/hooks/useChatScroll'
import { cn } from '@superone/ui/lib/utils'

interface SessionPaneProps {
  scope?: SessionScope
  className?: string
}

function SessionPaneBody({ className }: { className?: string }) {
  const scrollViewportRef = useRef<HTMLDivElement>(null)
  const { showScrollButton, scrollToBottom } = useChatScroll({ scrollViewportRef })
  return (
    <div className={cn('@container flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden', className)}>
      <ChatContent scrollViewportRef={scrollViewportRef} showScrollButton={showScrollButton} scrollToBottom={scrollToBottom} />
    </div>
  )
}

export function SessionPane({ scope, className }: SessionPaneProps) {
  const value = useMemo(
    () => (scope ? { projectPath: scope.projectPath, sessionId: scope.sessionId } : null),
    [scope?.projectPath, scope?.sessionId],
  )
  if (!value) return <SessionPaneBody className={className} />
  return (
    <SessionScopeProvider value={value}>
      <SessionPaneBody className={className} />
    </SessionScopeProvider>
  )
}
