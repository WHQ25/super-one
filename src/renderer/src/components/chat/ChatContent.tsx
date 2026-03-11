import { useRef, useState, useEffect, useLayoutEffect, useMemo } from 'react'
import { useChatStore, useActiveSession } from '@/stores/chat'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ArrowDown, GitFork, PenLine, Trash2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { ChatInput } from './ChatInput'
import { ChatStatusBar } from './ChatStatusBar'
import { ChatMessage, CompactingIndicator, CompactIndicator, RateLimitIndicator, UserTextBlock, parseCompactMarker } from './ChatMessage'
import { AttachmentBar } from './AttachmentBar'
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
  const worktreeRemoved = useActiveSession((s) => s._worktreeRemoved)
  const prefireMessage = useActiveSession((s) => s.prefireMessage)
  const cancelPrefireMessage = useChatStore((s) => s.cancelPrefireMessage)
  const discardPrefireMessage = useChatStore((s) => s.discardPrefireMessage)
  const [dismissedRateLimitKey, setDismissedRateLimitKey] = useState<string | null>(null)
  const rateLimitInfoKey = useMemo(
    () => rateLimitInfo
      ? `${rateLimitInfo.status}:${rateLimitInfo.resetsAt ?? ''}:${rateLimitInfo.rateLimitType ?? ''}:${rateLimitInfo.utilization ?? ''}`
      : null,
    [rateLimitInfo],
  )
  const showRateLimitIndicator = !!rateLimitInfo && rateLimitInfoKey !== dismissedRateLimitKey

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

  useEffect(() => {
    if (!rateLimitInfo) setDismissedRateLimitKey(null)
  }, [rateLimitInfo])

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
                  {prefireMessage && (
                    <div className="group/prefire chat-message-wrapper opacity-50">
                      <div className="flex w-0 min-w-full justify-end">
                        <div className="flex min-w-0 max-w-[85%] flex-col items-end">
                          <div className="min-w-0 break-all rounded-xl bg-secondary px-3 py-2 text-sm text-secondary-foreground">
                            {prefireMessage.attachments.length > 0 && (
                              <AttachmentBar attachments={prefireMessage.attachments} />
                            )}
                            <UserTextBlock text={prefireMessage.content} />
                          </div>
                          <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover/prefire:opacity-100">
                            <button onClick={cancelPrefireMessage} className="cursor-pointer rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground">
                              <PenLine className="size-3" />
                            </button>
                            <button onClick={discardPrefireMessage} className="cursor-pointer rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground">
                              <Trash2 className="size-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {isCompacting && <CompactingIndicator />}
                  {showRateLimitIndicator && rateLimitInfo && (
                    <RateLimitIndicator
                      info={rateLimitInfo}
                      onDismiss={() => {
                        if (rateLimitInfoKey) setDismissedRateLimitKey(rateLimitInfoKey)
                      }}
                    />
                  )}
                </div>
              </ScrollArea>
            )}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-linear-to-t from-card to-transparent" />
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
            {worktreeRemoved ? (
              <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 px-4 py-3 text-sm text-muted-foreground">
                <GitFork className="size-3.5 shrink-0" />
                <span>Worktree has been removed.</span>
                <span>This session is now <em>READ ONLY</em>.</span>
              </div>
            ) : (
              <>
                <PermissionPrompt />
                <AskUserQuestionPrompt />
                <TodoPopup />
                <ChatInput />
                {externalHistory && <ChatStatusBar />}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
