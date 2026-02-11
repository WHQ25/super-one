import { useRef, useState, useEffect } from 'react'
import { useChatStore, useActiveSession } from '@/stores/chat'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ChatInput } from './ChatInput'
import { ChatMessage } from './ChatMessage'
import { ChatSuggestions } from './ChatSuggestions'
import { PermissionPrompt } from './PermissionPrompt'
import { AskUserQuestionPrompt } from './AskUserQuestionPrompt'
import { SlashCommandOverlay } from './SlashCommandOverlay'
import { TodoPopup } from './TodoPopup'
import { PlanApprovalPrompt } from './PlanApprovalPrompt'
import { SessionHistory } from './SessionHistory'


interface ChatContentProps {
  scrollViewportRef: React.RefObject<HTMLDivElement | null>
  /** When true, skip showHistory branch (history displayed externally, e.g. in sidebar) */
  externalHistory?: boolean
}

export function ChatContent({ scrollViewportRef, externalHistory = false }: ChatContentProps) {
  const messages = useActiveSession((s) => s.messages)
  const pendingPlanApproval = useActiveSession((s) => s.pendingPlanApproval)
  const showHistory = useActiveSession((s) => s.showHistory)
  const historySessionId = useActiveSession((s) => s._historySessionId)

  // Auto-zoom based on own container width
  const containerRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      setZoom(w >= 672 ? 1.15 : w >= 512 ? 1.1 : 1)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={containerRef} className="relative mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col bg-card" style={zoom !== 1 ? { zoom } : undefined}>
      {!externalHistory && showHistory ? (
        <SessionHistory />
      ) : pendingPlanApproval ? (
        <PlanApprovalPrompt />
      ) : (
        <>
          <SlashCommandOverlay />
          <div className="flex-1 overflow-hidden">
            {messages.length === 0 ? (
              <ChatSuggestions />
            ) : (
              <ScrollArea key={historySessionId ?? 'default'} className="h-full animate-[fade-in_150ms_ease-out]" viewportRef={scrollViewportRef}>
                <div className="flex flex-col gap-1.5 p-3 @lg:gap-2.5 @lg:p-3.5 @2xl:gap-2.5 @2xl:p-4">
                  {messages.map((msg) => (
                    <ChatMessage key={msg.id} message={msg} />
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
          <PermissionPrompt />
          <AskUserQuestionPrompt />
          <TodoPopup />
          <ChatInput />
        </>
      )}
    </div>
  )
}
