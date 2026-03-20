import { useRef, useState, useEffect, useLayoutEffect, useMemo, useCallback } from 'react'
import { useChatStore, useActiveSession, useIsRemoteLocked } from '@/stores/chat'
import { useShallow } from 'zustand/react/shallow'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ArrowDown, Check, ClipboardList, Copy, GitFork, PenLine, Smartphone, Trash2, X } from 'lucide-react'
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
import { PlanFullscreenContext } from './codex-item-renderer'
import { MarkdownView } from '@/components/MarkdownPreview'


function CodexPlanFullscreenView({ text, onClose }: { text: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <ClipboardList className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">Plan</span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={handleCopy} className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-foreground" title="Copy plan">
            {copied ? <Check className="size-3.5 text-green-400" /> : <Copy className="size-3.5" />}
          </button>
          <button onClick={onClose} className="cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-foreground" title="Close">
            <X className="size-3.5" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <MarkdownView content={text} className="px-6 py-4 text-sm" />
      </div>
    </div>
  )
}

interface ChatContentProps {
  scrollViewportRef: React.RefObject<HTMLDivElement | null>
  showScrollButton?: boolean
  scrollToBottom?: () => void
  /** When true, skip showHistory branch (history displayed externally, e.g. in sidebar) */
  externalHistory?: boolean
}

export function ChatContent({ scrollViewportRef, showScrollButton = false, scrollToBottom, externalHistory = false }: ChatContentProps) {
  const {
    messages, isCompacting, rateLimitInfo, pendingPlanApproval,
    showHistory, historySessionId, hasActiveSession, worktreeRemoved, prefireMessage,
    sessionStatus, lastAssistantMessageId,
  } = useActiveSession(useShallow((s) => ({
    messages: s.messages,
    isCompacting: s.isCompacting,
    rateLimitInfo: s.rateLimitInfo,
    pendingPlanApproval: s.pendingPlanApproval,
    showHistory: s.showHistory,
    historySessionId: s._activeSessionId,
    hasActiveSession: !!s.session,
    worktreeRemoved: s._worktreeRemoved,
    prefireMessage: s.prefireMessage,
    sessionStatus: s.status,
    lastAssistantMessageId: s.lastAssistantMessageId,
  })))
  const { cancelPrefireMessage, discardPrefireMessage, disconnectRemoteSession } = useChatStore(useShallow((s) => ({
    cancelPrefireMessage: s.cancelPrefireMessage,
    discardPrefireMessage: s.discardPrefireMessage,
    disconnectRemoteSession: s.disconnectRemoteSession,
  })))
  const isRemoteLocked = useIsRemoteLocked()
  const [fullscreenPlanText, setFullscreenPlanText] = useState<string | null>(null)
  const planFullscreenCtx = useMemo(() => ({ open: (text: string) => setFullscreenPlanText(text) }), [])
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

  const INITIAL_RENDER_COUNT = 12
  const LOAD_MORE_COUNT = 4
  const [renderCount, setRenderCount] = useState(INITIAL_RENDER_COUNT)
  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => { setRenderCount(INITIAL_RENDER_COUNT) }, [historySessionId])
  const hasMore = renderCount < visibleMessages.length
  const renderedMessages = hasMore ? visibleMessages.slice(-renderCount) : visibleMessages

  useEffect(() => {
    const sentinel = sentinelRef.current
    const viewport = scrollViewportRef.current
    if (!sentinel || !viewport || !hasMore) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setRenderCount((c) => Math.min(c + LOAD_MORE_COUNT, visibleMessages.length))
        }
      },
      { root: viewport, rootMargin: '800px 0px 0px 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, visibleMessages.length, scrollViewportRef])

  const computeZoom = useCallback((w: number) => w >= 672 ? 1.15 : w >= 512 ? 1.1 : 1, [])
  const [zoom, setZoom] = useState(1)
  useLayoutEffect(() => {
    const parent = containerRef.current?.parentElement
    if (!parent) return
    setZoom(computeZoom(parent.getBoundingClientRect().width))
    const observer = new ResizeObserver((entries) => {
      setZoom(computeZoom(entries[0]?.contentRect.width ?? 0))
    })
    observer.observe(parent)
    return () => observer.disconnect()
  }, [computeZoom])

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
    <PlanFullscreenContext.Provider value={planFullscreenCtx}>
    <div ref={containerRef} className="relative flex min-h-0 w-full flex-1 flex-col bg-card" style={zoom !== 1 ? { zoom } : undefined}>
      {fullscreenPlanText ? (
        <CodexPlanFullscreenView text={fullscreenPlanText} onClose={() => setFullscreenPlanText(null)} />
      ) : !externalHistory && showHistory ? (
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
                  {hasMore && <div ref={sentinelRef} className="h-px" style={{ overflowAnchor: 'none' }} />}
                  {renderedMessages.map((msg) => {
                    const compactInfo = parseCompactMarker(msg)
                    if (compactInfo) {
                      const origIdx = messages.indexOf(msg)
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
                        <ChatMessage message={msg} sessionStatus={sessionStatus} isLastAssistant={msg.id === lastAssistantMessageId} />
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
            ) : isRemoteLocked ? (
              <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 px-4 py-3 text-sm text-muted-foreground">
                <Smartphone className="size-3.5 shrink-0" />
                <span>Remote session active — observation mode.</span>
                <button
                  onClick={disconnectRemoteSession}
                  className="text-foreground underline underline-offset-2 hover:opacity-80"
                >
                  Disconnect
                </button>
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
    </PlanFullscreenContext.Provider>
  )
}
