import { useRef, useEffect } from 'react'
import { useChatStore } from '@/stores/chat'
import { ChatContent } from '@/components/chat/ChatContent'
import { useChatScroll } from '@/hooks/useChatScroll'
import { useChatKeyboardShortcuts } from '@/hooks/useChatKeyboardShortcuts'

export function CodingLayout() {
  const scrollViewportRef = useRef<HTMLDivElement>(null)

  const { showScrollButton, scrollToBottom } = useChatScroll({ scrollViewportRef })
  useChatKeyboardShortcuts()

  // Ensure chat is "open" for ChatInput auto-focus
  useEffect(() => {
    const store = useChatStore.getState()
    if (!store.isOpen) store.toggleOpen()
  }, [])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="@container flex min-h-0 flex-1 flex-col bg-card">
        <ChatContent scrollViewportRef={scrollViewportRef} showScrollButton={showScrollButton} scrollToBottom={scrollToBottom} externalHistory />
      </div>
    </div>
  )
}
