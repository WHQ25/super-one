import { useRef, useState, useEffect, useLayoutEffect, useMemo } from 'react'
import { useChatStore, useActiveSession } from '@/stores/chat'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ArrowDown } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { ChatInput } from './ChatInput'
import { ChatStatusBar } from './ChatStatusBar'
import { ChatMessage, CompactingIndicator, CompactIndicator, RateLimitIndicator, parseCompactMarker } from './ChatMessage'
import { ChatSuggestions } from './ChatSuggestions'
import { PermissionPrompt } from './PermissionPrompt'
import { AskUserQuestionPrompt } from './AskUserQuestionPrompt'
import { SlashCommandOverlay } from './SlashCommandOverlay'
import { TodoPopup } from './TodoPopup'
import { PlanApprovalPrompt } from './PlanApprovalPrompt'
import { SessionHistory } from './SessionHistory'


interface ChatContentProps {
  scrollViewportRef: React.RefObject<HTMLDivElement | null>
  showScrollButton?: boolean
  scrollToBottom?: () => void
  /** When true, skip showHistory branch (history displayed externally, e.g. in sidebar) */
  externalHistory?: boolean
}

export function ChatContent({ scrollViewportRef, showScrollButton = false, scrollToBottom, externalHistory = false }: ChatContentProps) {
  const messages = useActiveSession((s) => s.messages)
  const isCompacting = useActiveSession((s) => s.isCompacting)
  const rateLimitInfo = useActiveSession((s) => s.rateLimitInfo)
  const pendingPlanApproval = useActiveSession((s) => s.pendingPlanApproval)
  const showHistory = useActiveSession((s) => s.showHistory)
  const historySessionId = useActiveSession((s) => s._activeSessionId)
  const hasActiveSession = useActiveSession((s) => !!s.session)

  const containerRef = useRef<HTMLDivElement>(null)
  const prevScrollHeightRef = useRef(0)
  const [expandLevel, setExpandLevel] = useState(0)
  const compactIndices = useMemo(
    () => messages.flatMap((msg, i) => (parseCompactMarker(msg) ? [i] : [])),
    [messages]
  )
  const visibleStart =
    compactIndices.length > 0 && expandLevel < compactIndices.length
      ? compactIndices[compactIndices.length - 1 - expandLevel]
      : 0
  const visibleMessages = visibleStart > 0 ? messages.slice(visibleStart) : messages
  const [zoom, setZoom] = useState(1)
  useEffect(() => {
    const parent = containerRef.current?.parentElement
    if (!parent) return
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      setZoom(w >= 672 ? 1.15 : w >= 512 ? 1.1 : 1)
    })
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport || prevScrollHeightRef.current === 0) return
    const delta = viewport.scrollHeight - prevScrollHeightRef.current
    viewport.scrollTop += delta
    prevScrollHeightRef.current = 0
  }, [expandLevel])

  return (
    <div ref={containerRef} className="relative flex min-h-0 w-full flex-1 flex-col bg-card" style={zoom !== 1 ? { zoom } : undefined}>
      {!externalHistory && showHistory ? (
        <SessionHistory />
      ) : pendingPlanApproval ? (
        <PlanApprovalPrompt />
      ) : (
        <>
          <SlashCommandOverlay />
          <div className="relative flex-1 overflow-hidden">
            {messages.length === 0 && !hasActiveSession ? (
              <ChatSuggestions />
            ) : (
              <ScrollArea key={historySessionId ?? 'default'} className="h-full animate-[fade-in_150ms_ease-out]" viewportRef={scrollViewportRef}>
                <div className="mx-auto flex max-w-3xl flex-col gap-1 p-3 @lg:gap-1.5 @lg:p-3.5 @2xl:gap-1.5 @2xl:p-4">
                  {visibleMessages.map((msg, visIdx) => {
                    const compactInfo = parseCompactMarker(msg)
                    if (compactInfo) {
                      const origIdx = visibleStart + visIdx
                      const rank = compactIndices.length - 1 - compactIndices.indexOf(origIdx)
                      const isExpanded = rank < expandLevel
                      return (
                        <CompactIndicator
                          key={msg.id}
                          trigger={compactInfo.trigger}
                          preTokens={compactInfo.preTokens}
                          expanded={isExpanded}
                          onToggle={() => {
                            prevScrollHeightRef.current = scrollViewportRef.current?.scrollHeight ?? 0
                            setExpandLevel(isExpanded ? rank : rank + 1)
                          }}
                        />
                      )
                    }
                    return (
                      <div key={msg.id} className="chat-message-wrapper">
                        <ChatMessage message={msg} />
                      </div>
                    )
                  })}
                  {isCompacting && <CompactingIndicator />}
                  {rateLimitInfo && <RateLimitIndicator info={rateLimitInfo} />}
                </div>
              </ScrollArea>
            )}
            <AnimatePresence>
              {showScrollButton && scrollToBottom && messages.length > 0 && (
                <motion.button
                  onClick={scrollToBottom}
                  className="absolute bottom-3 left-1/2 z-10 flex size-7 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:text-foreground"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.15 }}
                >
                  <ArrowDown className="size-3.5" />
                </motion.button>
              )}
            </AnimatePresence>
          </div>
          <div className="mx-auto w-full max-w-3xl">
            <PermissionPrompt />
            <AskUserQuestionPrompt />
            <TodoPopup />
            <ChatInput />
            {externalHistory && <ChatStatusBar />}
          </div>
        </>
      )}
    </div>
  )
}
