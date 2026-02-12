import { useRef, useState, useEffect } from 'react'
import { useChatStore } from '@/stores/chat'
import { ChatContent } from '@/components/chat/ChatContent'
import { useChatScroll } from '@/hooks/useChatScroll'
import { useChatKeyboardShortcuts } from '@/hooks/useChatKeyboardShortcuts'
import { StatusBar } from './StatusBar'
import { TerminalPanel } from './TerminalPanel'
import { CodeReviewPanel } from './CodeReviewPanel'
import { cn } from '@/lib/utils'

export function CodingLayout() {
  const scrollViewportRef = useRef<HTMLDivElement>(null)

  useChatScroll({ scrollViewportRef })
  useChatKeyboardShortcuts()

  // Ensure chat is "open" for ChatInput auto-focus
  useEffect(() => {
    const store = useChatStore.getState()
    if (!store.isOpen) store.toggleOpen()
  }, [])

  // Panel visibility
  const [showBottomPanel, setShowBottomPanel] = useState(false)
  const [showRightSidebar, setShowRightSidebar] = useState(false)

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Main area */}
      <div className="flex min-h-0 flex-1">
        {/* Center area */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Chat content */}
          <div className={cn('@container flex min-h-0 flex-1 flex-col bg-card')}>
            <ChatContent scrollViewportRef={scrollViewportRef} externalHistory />
          </div>

          {/* Bottom panel — Terminal placeholder */}
          {showBottomPanel && (
            <div className="h-48 shrink-0 border-t border-border bg-background">
              <TerminalPanel />
            </div>
          )}
        </div>

        {/* Right sidebar — Code review placeholder */}
        {showRightSidebar && (
          <div className="w-80 shrink-0 border-l border-border bg-background">
            <CodeReviewPanel />
          </div>
        )}
      </div>

      {/* Status bar */}
      <StatusBar
        showBottomPanel={showBottomPanel}
        showRightSidebar={showRightSidebar}
        onToggleBottomPanel={() => setShowBottomPanel((v) => !v)}
        onToggleRightSidebar={() => setShowRightSidebar((v) => !v)}
      />
    </div>
  )
}
