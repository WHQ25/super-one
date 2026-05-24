import { useRef, useState, useEffect, useLayoutEffect, useMemo, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useChatStore, useActiveSession, useIsRemoteLocked } from '@/stores/chat'
import { useShallow } from 'zustand/react/shallow'
import { ScrollArea } from '@superone/ui/components/ui/scroll-area'
import { ArrowDown, GitFork, PenLine, Smartphone, Trash2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { ChatInput } from './ChatInput'
import { ChatStatusBar } from './ChatStatusBar'
import { ChatMessage, CompactingIndicator, CompactIndicator, RateLimitIndicator, ApiRetryIndicator, parseCompactMarker } from './ChatMessage'
import { ChatSuggestions } from './ChatSuggestions'
import { PermissionPrompt } from './PermissionPrompt'
import { AskUserQuestionPrompt } from './AskUserQuestionPrompt'
import { TodoPopup } from './TodoPopup'
import { PlanApprovalPrompt } from './PlanApprovalPrompt'
import { PlanFullscreenContext } from './codex-item-renderer'
import { CodexPlanFullscreenView } from './CodexPlanFullscreenView'
import { ForkNavigationContext, type ForkViewState } from './fork-navigation-context'
import { ForkedThreadView } from './ForkedThreadView'
import { SubagentNavigationContext, type SubagentViewState } from './subagent-navigation-context'
import { SubagentFullView } from './SubagentFullView'
import { SelectionContextMenuZone } from './SelectionContextMenu'
import type { CodexPlanApprovalState } from '@superone/shared/agent-types'
import { cn } from '@superone/ui/lib/utils'

interface ChatContentProps {
  scrollViewportRef: React.RefObject<HTMLDivElement | null>
  showScrollButton?: boolean
  scrollToBottom?: () => void
}

export function ChatContent({ scrollViewportRef, showScrollButton = false, scrollToBottom }: ChatContentProps) {
  const {
    messages, isCompacting, rateLimitInfo, apiRetry, pendingPlanApproval,
    historySessionId, historyHydrated, worktreeRemoved,
    sessionStatus, lastAssistantMessageId, queuedMessages, awaitingAssistantReply,
  } = useActiveSession(useShallow((s) => ({
    messages: s.messages,
    isCompacting: s.isCompacting,
    rateLimitInfo: s.rateLimitInfo,
    apiRetry: s.apiRetry,
    pendingPlanApproval: s.pendingPlanApproval,
    historySessionId: s._activeSessionId,
    historyHydrated: s._historyHydrated,
    worktreeRemoved: s._worktreeRemoved,
    sessionStatus: s.status,
    lastAssistantMessageId: s.lastAssistantMessageId,
    queuedMessages: s.queuedMessages,
    awaitingAssistantReply: s.awaitingAssistantReply,
  })))
  const { editQueuedMessage, deleteQueuedMessage, disconnectRemoteSession } = useChatStore(useShallow((s) => ({
    editQueuedMessage: s.editQueuedMessage,
    deleteQueuedMessage: s.deleteQueuedMessage,
    disconnectRemoteSession: s.disconnectRemoteSession,
  })))
  const isRemoteLocked = useIsRemoteLocked()
  const [fullscreenPlan, setFullscreenPlan] = useState<{
    text: string
    onApprovePlan?: () => void
    onRejectPlan?: (feedback?: string) => void
    planApproval?: CodexPlanApprovalState
  } | null>(null)
  const planFullscreenCtx = useMemo(() => ({
    open: (
      text: string,
      actions?: { onApprove?: () => void; onReject?: (feedback?: string) => void; planApproval?: CodexPlanApprovalState },
    ) => setFullscreenPlan({
      text,
      onApprovePlan: actions?.onApprove,
      onRejectPlan: actions?.onReject,
      planApproval: actions?.planApproval,
    }),
  }), [])
  const [dismissedRateLimitKey, setDismissedRateLimitKey] = useState<string | null>(null)
  const rateLimitInfoKey = useMemo(
    () => rateLimitInfo
      ? `${rateLimitInfo.status}:${rateLimitInfo.resetsAt ?? ''}:${rateLimitInfo.rateLimitType ?? ''}:${rateLimitInfo.utilization != null ? Math.floor(rateLimitInfo.utilization * 20) : ''}`
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

  const virtualizer = useVirtualizer({
    count: visibleMessages.length,
    getScrollElement: () => scrollViewportRef.current,
    estimateSize: () => 200,
    overscan: 6,
    getItemKey: (index) => visibleMessages[index]?.id ?? index,
  })
  const virtualItems = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()

  const computeAutoZoom = useCallback((w: number) => w >= 672 ? 1.15 : w >= 512 ? 1.1 : 1, [])
  const [autoZoom, setAutoZoom] = useState(1)
  const [manualZoom, setManualZoom] = useState(0)
  const zoom = autoZoom + manualZoom
  useLayoutEffect(() => {
    const parent = containerRef.current?.parentElement
    if (!parent) return
    setAutoZoom(computeAutoZoom(parent.getBoundingClientRect().width))
    let rafId = 0
    const observer = new ResizeObserver((entries) => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        const next = computeAutoZoom(entries[0]?.contentRect.width ?? 0)
        setAutoZoom((prev) => prev === next ? prev : next)
      })
    })
    observer.observe(parent)
    return () => { cancelAnimationFrame(rafId); observer.disconnect() }
  }, [computeAutoZoom])

  useEffect(() => {
    return window.app.onContentZoom((action) => {
      if (!containerRef.current?.matches(':hover')) return
      if (action === 'reset') setManualZoom(0)
      else if (action === 'in') setManualZoom((v) => Math.min(v + 0.05, 0.5))
      else setManualZoom((v) => Math.max(v - 0.05, -0.5))
    })
  }, [])

  useLayoutEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport || prevScrollHeightRef.current === 0) return
    const delta = viewport.scrollHeight - prevScrollHeightRef.current
    viewport.scrollTop += delta
    prevScrollHeightRef.current = 0
  }, [expandLevel])

  const [fork, setFork] = useState<ForkViewState | null>(null)
  const forkNav = useMemo(() => ({
    current: fork,
    open: (state: ForkViewState) => setFork(state),
    close: () => setFork(null),
  }), [fork])

  const [subagentView, setSubagentView] = useState<SubagentViewState | null>(null)
  const subagentNav = useMemo(() => ({
    current: subagentView,
    open: (state: SubagentViewState) => setSubagentView(state),
    close: () => setSubagentView(null),
  }), [subagentView])

  return (
    <SubagentNavigationContext.Provider value={subagentNav}>
    <ForkNavigationContext.Provider value={forkNav}>
    <PlanFullscreenContext.Provider value={planFullscreenCtx}>
    <div ref={containerRef} className={cn('relative flex min-h-0 min-w-0 flex-col bg-card', zoom <= 1 && 'w-full flex-1')} style={zoom > 1 ? { transform: `scale(${zoom})`, transformOrigin: 'top left', width: `${100 / zoom}%`, height: `${100 / zoom}%` } : zoom < 1 ? { zoom } : undefined}>
      {subagentView ? (
        <SubagentFullView view={subagentView} />
      ) : fork ? (
        <ForkedThreadView fork={fork} />
      ) : fullscreenPlan ? (
        <CodexPlanFullscreenView
          text={fullscreenPlan.text}
          onApprovePlan={fullscreenPlan.onApprovePlan}
          onRejectPlan={fullscreenPlan.onRejectPlan}
          planApproval={fullscreenPlan.planApproval}
          onClose={(reason) => {
            setFullscreenPlan(null)
            if (reason === 'reject') {
              requestAnimationFrame(() => scrollToBottom?.())
            }
          }}
        />
      ) : pendingPlanApproval ? (
        <PlanApprovalPrompt />
      ) : (
        <>
          <div className="relative min-w-0 flex-1 overflow-hidden">
            {messages.length === 0 && historyHydrated && sessionStatus !== 'streaming' && sessionStatus !== 'background' && !awaitingAssistantReply ? (
              <ChatSuggestions />
            ) : (
              <ScrollArea key={historySessionId ?? 'default'} className="chat-scroll-area h-full min-w-0 animate-[fade-in_150ms_ease-out]" viewportRef={scrollViewportRef}>
                <SelectionContextMenuZone className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-1 p-3 @lg:gap-1.5 @lg:p-3.5 @2xl:gap-1.5 @2xl:p-4">
                  <div style={{ height: totalSize, position: 'relative', width: '100%' }}>
                    {virtualItems.map((item) => {
                      const msg = visibleMessages[item.index]
                      if (!msg) return null
                      const compactInfo = parseCompactMarker(msg)
                      const inner = compactInfo ? (() => {
                        const origIdx = messages.indexOf(msg)
                        const rank = compactIndices.length - 1 - compactIndices.indexOf(origIdx)
                        const isExpanded = rank < expandLevel
                        return (
                          <CompactIndicator
                            trigger={compactInfo.trigger}
                            preTokens={compactInfo.preTokens}
                            expanded={isExpanded}
                            onToggle={() => {
                              prevScrollHeightRef.current = scrollViewportRef.current?.scrollHeight ?? 0
                              setExpandLevel(isExpanded ? rank : rank + 1)
                            }}
                          />
                        )
                      })() : (
                        <div className="chat-message-wrapper">
                          <ChatMessage message={msg} sessionStatus={sessionStatus} isLastAssistant={msg.id === lastAssistantMessageId} />
                        </div>
                      )
                      return (
                        <div
                          key={item.key}
                          data-index={item.index}
                          ref={virtualizer.measureElement}
                          style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start}px)`, paddingBottom: 6 }}
                        >
                          {inner}
                        </div>
                      )
                    })}
                  </div>
                  {queuedMessages.map((msg) => (
                    <div key={msg.id} className="group/queued chat-message-wrapper opacity-50">
                      <ChatMessage message={msg} sessionStatus={sessionStatus} isLastAssistant={false} hideUserActions />
                      <div className="flex justify-end pr-1">
                        <div className="-mt-0.5 flex items-center gap-1 opacity-0 transition-opacity group-hover/queued:opacity-100">
                          <button onClick={() => editQueuedMessage(msg.id)} className="cursor-pointer rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground">
                            <PenLine className="size-3" />
                          </button>
                          <button onClick={() => deleteQueuedMessage(msg.id)} className="cursor-pointer rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground">
                            <Trash2 className="size-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {isCompacting && <CompactingIndicator />}
                  {apiRetry && <ApiRetryIndicator info={apiRetry} />}
                  {showRateLimitIndicator && rateLimitInfo && (
                    <RateLimitIndicator
                      info={rateLimitInfo}
                      onDismiss={() => {
                        if (rateLimitInfoKey) setDismissedRateLimitKey(rateLimitInfoKey)
                      }}
                    />
                  )}
                </SelectionContextMenuZone>
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
          <div className="mx-auto w-full min-w-0 max-w-3xl">
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
                <ChatStatusBar />
              </>
            )}
          </div>
        </>
      )}
    </div>
    </PlanFullscreenContext.Provider>
    </ForkNavigationContext.Provider>
    </SubagentNavigationContext.Provider>
  )
}
