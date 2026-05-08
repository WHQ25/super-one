import { useRef, useEffect, memo } from 'react'
import { useChatStore } from '@/stores/chat'
import { ChatContent } from '@/components/chat/ChatContent'
import { SessionSwitcherPopup } from '@/components/chat/SessionSwitcherPopup'
import { useChatScroll } from '@/hooks/useChatScroll'
import { useChatKeyboardShortcuts } from '@/hooks/useChatKeyboardShortcuts'

export const CodingLayout = memo(function CodingLayout() {
  const scrollViewportRef = useRef<HTMLDivElement>(null)
  const chatScopeRef = useRef<HTMLDivElement>(null)

  const { showScrollButton, scrollToBottom } = useChatScroll({ scrollViewportRef })
  useChatKeyboardShortcuts()

  // Ensure chat is "open" for ChatInput auto-focus
  useEffect(() => {
    const store = useChatStore.getState()
    if (!store.isOpen) store.toggleOpen()
  }, [])

  return (
    <div ref={chatScopeRef} className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="@container flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-card">
        <ChatContent scrollViewportRef={scrollViewportRef} showScrollButton={showScrollButton} scrollToBottom={scrollToBottom} />
      </div>
      <SessionSwitcherPopup scopeRef={chatScopeRef} />
    </div>
  )
})
